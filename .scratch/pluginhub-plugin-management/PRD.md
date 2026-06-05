Status: ready-for-human

# PRD: PluginHub 插件库与项目插件安装

## Problem Statement

用户希望在本机集中管理 agentic plugin。`wshobson/agents` 这类仓库不是一个单一插件，而是一个 plugin library/source：里面包含很多可安装 plugin，每个 plugin 又组合 agents、skills、commands、hooks、MCP 或私有协调文件。现有 `SkillHub`、`McpHub`、`HookHub` 已经分别管理单类资源，但还缺少一个面向“完整 plugin”的入口。

如果把 plugin 简化成一组复制出来的 skill 或 agent，会丢失上游 plugin 的组合语义。部分 plugin 内部存在协调说明、命令、模板或工具私有文件，拆成单个组件后可能无法按原设计工作。另一方面，用户也希望从一个 plugin library 中单独使用某个 skill 或 agent，而不是必须安装整个 plugin。

还需要区分 Codex/Claude 等工具里的“marketplace source”和“plugin install”语义。对本应用来说，`PluginHub` 是全局 plugin 市场；导入 `wshobson/agents` 或单个外部 plugin 是把外部内容加入本应用的 `PluginHub`，不是把每个上游 source 都直接写成项目 marketplace。项目里安装 plugin 时，才从全局 `PluginHub` 选择某个 plugin 并生成目标工具能识别的完整插件包。

## Solution

新增顶层 `PluginHub`。`PluginHub` 管理三类对象：

- `source`：外部导入的 plugin library 或单个 plugin 自动包出来的同名 source，例如 `wshobson/agents`、`superpowers`。
- `source plugin`：来自某个 source 的 plugin，是 source 内的组合索引。
- `custom plugin`：用户在 `PluginHub` 内创建的组合清单，不属于任何 source。

`添加 Plugin` 用于导入外部 plugin library 或单个 plugin。导入 plugin library 时默认全量导入发现到的所有 plugin 和组件；导入单个 plugin 时，自动创建一个同名 source，并在该 source 下创建唯一 plugin。`创建 Plugin` 用于在 `PluginHub` 内创建 custom plugin。

Plugin 的组件不是以“属于某个 plugin”的方式进入组件 Hub。组件真实归属是 source。`SkillHub` 中的 skill source 应显示为 `wshobson/agents` 这类上游 source，而不是 `python-development` 这类 plugin；路径也应按 source-level 路径展示。Plugin 只是引用这些 source 组件的索引。`AgentHub`、`McpHub`、`HookHub` 后续也应遵循相同边界：组件记录知道 source，不需要知道有哪些 plugin 引用了它。

`PluginHub` 导入 source 后，需要识别 source 内的 plugin 组合和可抽取组件，并把组件交给对应 Hub 管理。对 `wshobson/agents` 这种物理上把 components 放在 `plugins/<plugin>/...` 的仓库，导入器需要生成 source-level 组件身份，再让 plugin 索引引用这些组件。多个 plugin 引用同一个组件时，不应在组件 Hub 里复制出多条“plugin-owned”组件。

完整 plugin 安装只能在项目的 `Plugin` 入口中进行。项目安装 plugin 后，项目侧创建一条 plugin binding，并记录该 plugin 实际拥有了哪些目标组件、哪些组件沿用了项目已有文件。完整 plugin 安装不是简单批量安装 skill/agent；对支持原生 plugin 的工具，应生成完整工具原生 plugin 包。单独安装某个 skill、agent、MCP 或 hook，仍然从对应 Hub 进入。

完整 plugin 安装必须先经过 harness 适配调研。`wshobson/agents` 的多工具支持不是同一套文件直接复制到所有工具，而是从 `plugins/` 这一 source-of-truth 生成 harness-native artifacts：Claude Code 使用 `.claude-plugin/marketplace.json` 和 `plugins/<name>/.claude-plugin/plugin.json`；Codex 使用 `.agents/plugins/marketplace.json` 和 `plugins/*/.codex-plugin/plugin.json`，并可生成 `.codex/skills/`、`.codex/agents/`；Cursor 使用 `.cursor-plugin/`、`.cursor/rules/` 并复用 Claude 结构；OpenCode、Gemini、Copilot 需要各自生成目录或 manifest。PluginHub 不能假设所有工具都能读取同一物理 plugin 目录。

项目技能页签需要扩展为 `SkillHub`、`Local`、`Plugin` 三类。`Plugin` 页签展示完整 plugin 安装带来的技能，按 plugin 分组。`SkillHub` 页签可以显示 plugin 安装带来的 skill，但这些行是只读：不能取消 plugin 的 skill，也不能用 SkillHub 安装同名 skill 去覆盖 plugin-owned skill。对应的 AgentHub 项目页签规则放到 AgentHub PRD 中展开。

项目安装 plugin 时执行 preflight。组件冲突按“目标路径是否被同一组件占用”判断，而不是只看同名：

- 同一组件已存在：不提示，追加当前 plugin owner。
- 不同组件或 local 文件占用同一目标路径：提示用户是否覆盖。
- 用户选择覆盖：新 plugin 接管该目标路径，旧 owner 从该路径移除。
- 用户选择不覆盖：旧 owner 或 local 文件保持不变，plugin 不拥有该组件，但 plugin binding 仍安装成功。
- local/unmanaged 文件被覆盖时，必须走统一项目本地文件覆盖保护与备份逻辑。

Plugin 安装成功不要求每个组件都被 plugin 接管。用户选择不覆盖某些组件时，plugin binding 仍然创建；项目 `Plugin` 页轻量显示例如 `12/15 components managed, 3 using existing project files`。展开详情时能看到哪些组件由 plugin 管理，哪些沿用项目已有文件。这不是 plugin 状态字段，只是卸载和同步必须使用的 ownership 明细。

Custom plugin 可以把组件标记为 `required` 或 optional。Required 组件遇到不同组件或 local 文件占用同一目标路径时，用户必须选择覆盖，否则安装或同步被阻止。Optional 组件遇到冲突时可以跳过，plugin binding 仍可创建。Source plugin 的普通组件默认按可跳过冲突处理，plugin-private 文件默认按 required 处理。

Plugin-private 文件不进入 `SkillHub`、`AgentHub`、`McpHub` 或 `HookHub`。它们只在完整 plugin 安装时由 `PluginHub` 管理，用于 manifest、命令胶水、模板、协调说明或其它工具私有内容。Private 文件如果和项目已有文件或另一个 plugin-private 文件目标路径冲突，不能静默跳过；不同 private 文件身份占用同一目标路径时应阻止安装或同步，因为这可能影响完整 plugin 生效。

更新分为内容更新和拓扑更新。组件原文件内容变化时，项目侧通过现有 link/materialize 机制自动感知，不需要 PluginHub 提供项目更新按钮。Plugin 的组成变化、MCP/hook/private 文件变化、custom plugin 清单变化属于拓扑更新，项目 `Plugin` 页显示同步入口。同步会重新跑 preflight：新增组件按冲突规则处理，移除组件只释放该 plugin owner，最后一个 owner 被释放时才删除目标文件或 link。

删除 source 时必须做影响预览。因为 custom plugin 可能引用该 source 里的组件，删除 source 不能留下断引用。用户需要选择：同时删除关联 custom plugin，或从 custom plugin 中移除相关组件。删除 source 会删除它导入的 source plugins 和 source 组件；删除单个 plugin 只删除组合索引和 private 文件，不删除仍属于 source 的组件。

## User Stories

1. As a local AI tool user, I want a top-level `PluginHub` entry, so that I can manage complete plugins from one place.
2. As a local AI tool user, I want `PluginHub` to act as the app's global plugin marketplace, so that project installs can choose from one local catalog.
3. As a local AI tool user, I want to click `添加 Plugin`, so that I can import an external plugin library or a single plugin package.
4. As a local AI tool user, I want importing `wshobson/agents` to import all discovered plugins by default, so that source import is separate from project selection.
5. As a local AI tool user, I want importing a single plugin to automatically wrap it in a same-name source, so that PluginHub has no bare plugin special case.
6. As a local AI tool user, I want source components to appear in SkillHub with source-level identity, so that skills are not shown as owned by one plugin.
7. As a local AI tool user, I want plugin records to reference component IDs, so that the same component can be reused by multiple plugins.
8. As a local AI tool user, I want to install a full plugin from a project's `Plugin` entry, so that coordinated plugin packages are applied as complete units.
9. As a local AI tool user, I want to install a single skill from `SkillHub`, so that I can use one piece of a plugin library without installing the full plugin.
10. As a local AI tool user, I want project plugin installation to preflight conflicts, so that I understand what files or components will be taken over.
11. As a local AI tool user, I want the same component used by two plugins to share ownership without prompting, so that uninstalling one plugin does not delete a component still used by another.
12. As a local AI tool user, I want different components targeting the same project path to ask whether to overwrite, so that ownership changes are explicit.
13. As a local AI tool user, I want choosing not to overwrite to still allow plugin installation, so that one local choice does not block the rest of a plugin.
14. As a local AI tool user, I want project `Plugin` rows to show managed versus existing component counts, so that partial ownership is visible without a complex status model.
15. As a local AI tool user, I want plugin-owned skills to be visible in project skill management, so that I can understand why a skill exists in the project.
16. As a local AI tool user, I want plugin-owned skills to be read-only in the `SkillHub` tab, so that I do not accidentally break a complete plugin from the wrong entry.
17. As a local AI tool user, I want a `Plugin` skill tab grouped by installed plugin, so that I can inspect the skill surface produced by complete plugins.
18. As a local AI tool user, I want local files to be backed up before plugin overwrite, so that unmanaged project work remains recoverable.
19. As a local AI tool user, I want plugin-private files to install only with complete plugins, so that internal coordination files are not exposed as standalone Hub components.
20. As a local AI tool user, I want plugin-private conflicts to block install or sync, so that a plugin is not installed in a partially broken native shape.
21. As a local AI tool user, I want custom plugins to be created in PluginHub, so that I can combine skills, agents, MCP, hooks, and private files into my own plugin.
22. As a local AI tool user, I want custom plugins to have no source, so that they are clearly local combinations rather than imported upstream content.
23. As a local AI tool user, I want custom plugin components to keep their own source identities, so that I can tell where each component came from.
24. As a local AI tool user, I want custom plugin components to support `required`, so that install can distinguish mandatory pieces from optional convenience pieces.
25. As a local AI tool user, I want custom plugins to support private files edited only in PluginHub, so that coordinated plugin material can be packaged with my custom plugin.
26. As a local AI tool user, I want plugin content updates to flow through existing links, so that project updates are not required for simple file changes.
27. As a local AI tool user, I want topology updates to show a sync button, so that new or removed plugin components are applied intentionally.
28. As a local AI tool user, I want plugin sync to reuse previous ownership decisions where possible, so that updates do not surprise me.
29. As a local AI tool user, I want uninstalling a plugin to release only that plugin's owners, so that shared components remain available.
30. As a local AI tool user, I want uninstalling a plugin not to restore overwritten previous versions, so that the ownership model stays simple.
31. As a local AI tool user, I want deleting a source to preview affected plugins, components, custom plugins, and projects, so that source deletion is safe.
32. As a local AI tool user, I want to choose whether source deletion also deletes custom plugins or removes affected custom plugin contents, so that I decide how to resolve references.
33. As a developer of the manager, I want PluginHub to call existing component Hub install/link logic, so that link behavior is not redesigned in this feature.
34. As a developer of the manager, I want plugin bindings to store ownership details instead of plugin status fields, so that delete and sync behavior is deterministic.
35. As a developer of the manager, I want AgentHub details to live in a separate PRD, so that PluginHub stays focused on complete plugin orchestration.

## Implementation Decisions

- `PluginHub` is a top-level Hub alongside `SkillHub`, `McpHub`, `HookHub`, and `CliHub`.
- Main PluginHub actions are `添加 Plugin` and `创建 Plugin`.
- `添加 Plugin` accepts an external plugin library/source or a single plugin package.
- Imported plugin libraries are sources and are imported fully by default.
- Imported single plugins are wrapped in a same-name source.
- `PluginHub` manages `source`, `source plugin`, `custom plugin`, plugin-private files, and plugin component indexes.
- `custom plugin` has no source.
- Component identity is owned by the component source, not by plugin.
- Plugin records reference component identities and do not duplicate component content.
- Component Hubs should not display “belongs to plugin” as a primary field.
- Plugin-private files do not enter component Hubs.
- Complete plugin install belongs only to the project `Plugin` entry.
- Single component install belongs only to the relevant component Hub.
- Complete plugin install creates a project plugin binding.
- Complete plugin install should generate a target-tool-native plugin package where the tool supports native plugins.
- Harness-native installation rules must be researched before implementing native package generation. `wshobson/agents` is the first reference source for this matrix.
- PluginHub should record enough harness support metadata to decide whether a plugin can be installed natively, installed through an existing component Hub, or blocked until an adapter exists.
- Project plugin binding records component ownership details needed for uninstall and sync.
- Ownership is evaluated at target path plus component identity.
- The same component at the same target path can have multiple owners.
- Different components targeting the same path require overwrite confirmation.
- Not overwriting a conflicting ordinary component does not fail the whole plugin install.
- Required custom plugin components must be overwritten or they block install and sync.
- Optional custom plugin components can be skipped when they conflict.
- Plugin-private target path conflicts block install or sync unless they are the same private file identity.
- Local/unmanaged file overwrite uses the shared project file backup flow.
- Plugin uninstall releases only the plugin's owners and removes files only when no owners remain.
- Plugin uninstall does not restore previously overwritten SkillHub or local files.
- Plugin content updates are automatic when existing component link/materialize behavior already points at updated source files.
- Plugin topology updates require explicit project sync.
- Sync recomputes the current plugin component/private-file graph and reruns preflight for new conflicts.
- Source deletion requires impact preview and a custom-plugin reference resolution choice.
- Source deletion removes source plugins and source-owned components.
- Deleting a plugin index does not delete source-owned components while the source remains.
- AgentHub product behavior is out of scope for this PRD except as a future component Hub integration point.

## Testing Decisions

- Tests should verify user-visible behavior at storage, import, component indexing, project install, conflict preflight, ownership release, private-file handling, sync, deletion preview, and UI seams.
- Harness adapter tests should be added only after the tool-specific install matrix is documented; tests should verify generated target artifacts for each supported harness rather than assuming shared output paths.
- Storage tests should cover source plugins, custom plugins, component references, private files, project plugin bindings, and multi-owner component records.
- Import tests should use local fixtures for a multi-plugin source and a single-plugin package.
- Import tests should verify that imported components have source-level identity and plugin records only reference them.
- Component integration tests should verify that PluginHub can expose skills to SkillHub without adding plugin ownership to SkillHub skill records.
- Project install tests should cover empty target install, same-component shared owner, different-component overwrite, different-component skip, local overwrite preflight, and successful partial ownership.
- Private-file tests should cover install, uninstall, sync add/remove, same-private shared owner, and different-private target conflict blocking.
- Project skill UI tests should cover `SkillHub` / `Local` / `Plugin` tabs, plugin-owned readonly rows, and managed versus existing counts.
- Sync tests should cover topology additions, removals, optional skipped components, required custom plugin conflicts, and private-file conflicts.
- Delete tests should cover source deletion previews, custom plugin reference choices, project binding impact, and plugin index deletion without component deletion.
- Similar seams already exist in SkillHub, McpHub, and HookHub: center list APIs, project panel APIs, delete previews, replacement preflight, and UI tests should be reused where possible.

## Out of Scope

- AgentHub page design and project agent tab behavior. This needs a separate AgentHub PRD.
- Reimplementing SkillHub's project link/materialize mechanism.
- Reimplementing McpHub or HookHub project write semantics.
- Treating PluginHub source import as a tool-native marketplace install.
- Per-plugin status fields such as installed, partial, broken, or stale.
- Lazy loading imported source content. Imported sources are stored locally when added.
- Showing every plugin that references a skill in SkillHub.
- Automatically merging same-name components across different sources.
- Automatically restoring overwritten local or SkillHub files after plugin uninstall.
- Allowing component Hubs to create or edit plugin-private files.
- Background plugin sync.
- Installing plugin-private files as standalone components.

## Further Notes

`wshobson/agents` is the reference external source for this PRD because it presents a single source-of-truth plugin library where each plugin combines agents, skills, commands, and other workflow material. The application model should be generic enough for similar libraries such as `superpowers`, local plugin packages, and user-created custom plugins.

Known `wshobson/agents` harness references to preserve during implementation research:

- Initial local research note: `.scratch/pluginhub-plugin-management/wshobson-harness-research.md`
- README: https://github.com/wshobson/agents
- Harness matrix: https://github.com/wshobson/agents/blob/main/docs/harnesses.md
- Adapter architecture: https://github.com/wshobson/agents/blob/main/ARCHITECTURE.md
- Authoring portability rules: https://github.com/wshobson/agents/blob/main/docs/authoring.md

The PluginHub implementation should preserve the existing Hub separation: global Hub pages manage reusable library resources, while project panels manage what is actually applied to a project or project group.

## Implementation Status

2026-06-05 已实现 PluginHub MVP：

- 顶层 `PluginHub` 页面、`Sources` / `Plugins` / `Custom Plugins` 分区、`添加 Plugin`、`创建 Plugin`、custom plugin edit/delete。
- PluginHub storage/API/service：source、source plugin、custom plugin、component refs、private files、project plugin bindings、delete previews。
- Local plugin library 与 single-plugin import；SkillHub skill 使用 source-level identity，PluginHub 只保存 component ref。
- Project `Plugin` panel：安装、sync、uninstall、managed/existing counts、topology hash、shared-owner release。
- Plugin-owned SkillHub targets 在项目技能面板中只读，并在 `Plugin` tab 按 plugin 分组。
- Plugin-private files：install/materialize、local overwrite preflight、backup metadata、private identity conflict block、uninstall cleanup、custom private material cleanup。
- Source/plugin delete impact preview：source components、custom plugin refs、project bindings、cleanup failure preservation。
- Harness research note: `.scratch/pluginhub-plugin-management/wshobson-harness-research.md`。

验证：

- `npm run check`
- `npm run test -- tests/pluginhub.test.ts tests/skillhub.test.ts tests/ui.test.tsx`
- `npm run build`
- Browser smoke test: `http://127.0.0.1:3987` 上打开 `PluginHub`，确认 heading、`Sources`、`Plugins`、`Custom Plugins`、`添加 Plugin`、`创建 Plugin` 存在，console warning/error 为空。

保留 follow-up：

- `.scratch/pluginhub-plugin-management/issues/05-unified-local-file-overwrite-backups.md` 中“shared use from at least one existing Hub plus PluginHub”未勾选。当前实现覆盖 PluginHub skill/private-file overwrite preflight 与 backup；现有 SkillHub local-folder overwrite path 仍是拒绝非 link 目标，而不是通用备份替换。
- 非 Codex harness-native package generation 仍按 research matrix 标为 planned；当前实现只 materialize PluginHub-managed private files，并保留 typed integration boundary。
