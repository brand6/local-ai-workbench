Status: ready-for-agent

# PRD: AgentHub Agent 管理与项目分发

## Problem Statement

用户在本机同时使用 Claude Code、Codex、OpenCode、Cursor、Qwen 等多个 AI coding 工具。不同工具都开始提供 agent、subagent、custom agent、rule 等类似能力，但文件格式、存放目录、主 agent/子 agent 语义和工具专用字段并不统一。用户需要能复用同一批 agent，并能把某个 agent 分发到不同项目和不同工具，而不是在每个项目里手动复制和改写文件。

项目当前已经有 `SkillHub`、`McpHub`、`HookHub`、`CliHub` 等 Hub 模式。AgentHub 需要沿用已经稳定的产品形态：顶层中心库管理可复用资源，项目详情中的 root/subproject group 面板管理当前项目启用状态。但 AgentHub 不能照搬 SkillHub 的 link 模型。SkillHub 分发的是统一 skill 目录；AgentHub 分发的是工具原生 agent 文件，同一个中心 agent 写到不同工具时需要转换为不同格式。

外部参考 `msitarzewski/agency-agents` 的成功模式：用一个源 agent 定义作为真源，再按工具生成各自格式。AgentHub 需要吸收这个模式，但不能调用外部仓库的 shell 脚本；解析、转换、预览、写入、状态检测和备份都应由本项目服务层控制。

## Solution

新增 `AgentHub`。顶层 `AgentHub` 是 app-owned agent 中心库。中心库中的每个 AgentHub agent 都保留一个原生真源文件，而不是强制统一成 Markdown。真源由 `sourceTruthTool` 和 `truthRole` 标识，例如 Claude subagent、Codex custom agent、Cursor rule、OpenCode subagent、Qwen subagent。中心库记录解析后的通用投影用于列表、搜索和跨工具转换，但用户打开和编辑的是中心库里的原生真源文件。

AgentHub MVP 内置 `msitarzewski/agency-agents` 的 packaged snapshot。该内置 source 由应用打包在 `builtin-agents/agency-agents`，首次进入 AgentHub 或项目 Agent 面板时懒加载导入。`agency-agents` 按它自己的文档和仓库结构解析 agent 位置，默认 truth tool 为 Claude/Markdown agent，不要求用户选择路径，不执行它仓库里的 `convert.sh` 或 `install.sh`。内置 source 可删除，可重新导入内置包；MVP 不做在线检查更新。

用户自定义导入只支持本地文件夹 source，不做自定义 GitHub source。用户必须明确选择 agent 文件夹和单一 truth tool。AgentHub 只在该文件夹内递归扫描可识别 agent 文件。导入后，原生真源文件被复制进 AgentHub library；原本的本地文件夹只是一次性导入来源，不再被跟踪、同步或重新扫描。再次导入同一个 source 时，新增 agent 正常导入，同 slug 且内容不同的 agent 进入冲突确认，不静默覆盖。

AgentHub 中心 source 保留为分组和来源记录。MVP source 类型为 `builtin` 和 `local-import`。`local-import` 记录原始路径、truth tool、导入时间和 label，但不代表持续同步关系。中心列表按 source 分组，支持搜索 name、description、slug、source label、truth tool、truth role、native path、sourceRelativePath 和 category。内置 `agency-agents` 的分类目录信息记录为 category 标签并参与搜索。

AgentHub MVP 目标工具只支持项目侧可附加 agent 单元，不管理或替换主 agent：

- Claude subagent：`<targetRootPath>/.claude/agents/<slug>.md`
- Codex custom agent：`<targetRootPath>/.codex/agents/<slug>.toml`
- OpenCode subagent：`<targetRootPath>/.opencode/agents/<slug>.md`
- Cursor rule：`<targetRootPath>/.cursor/rules/<slug>.mdc`
- Qwen subagent：`<targetRootPath>/.qwen/agents/<slug>.md`

项目侧 Agent 面板完全沿用 SkillHub 的项目面板形态：每个 root/subproject group 有 `Agent` 入口，面板包含 `AgentHub Agent` 和 `本地 Agent` 两个标签。`AgentHub Agent` 标签列出中心库 agent，按工具勾选启用或禁用。UI 只显示当前项目可用且可转换的目标工具，不展示不可用原因。列表中轻量显示 truth tool 和 truth role 标签。`本地 Agent` 标签扫描当前 group 的项目内目标目录，区分 managed 和 unmanaged 文件；unmanaged 文件可以迁移到 AgentHub，迁移目标选择沿用 SkillHub：迁移到已有 source 或新建 source。项目本地 unmanaged agent 迁移后，原项目文件立即登记为 managed binding。

AgentHub 项目侧写真实工具原生文件，不创建 link。绑定按 `projectId + targetRootPath + toolId + agentId + outputPath` 记录。启用时写目标文件，禁用时删除 AgentHub 管理且未 drift 的项目文件。Agent 文件名使用稳定 `slug`，不随 name 自动变化。重新解析中心真源可以更新 name、description、body、metadata 和 hash，但不会自动改 slug；slug 变更只能通过显式重命名动作，并展示已启用项目影响。

状态检测按项目目标文件快照和中心真源 hash 判断：

- `current`：项目文件仍等于上次 AgentHub 生成输出，中心 agent 也未变化。
- `outdated`：项目文件未被本地修改，但中心真源或转换输出已经变化。
- `drifted`：项目文件和上次 AgentHub 生成输出不一致。
- `missing`：binding 仍存在，但项目文件已经缺失。
- `unmanaged`：项目里存在可识别 agent/rule 文件，但没有 AgentHub binding。
- `invalid`：项目文件或中心真源无法由对应 adapter 解析。

`outdated` 可以批量同步；`drifted` 批量同步时跳过，必须在单个项目 target 里处理。Drifted target 提供从 AgentHub 覆盖、保存当前项目文件为新 AgentHub agent、仅移除 binding 或取消等恢复路径。禁用 target 时，`current` 和 `outdated` 可删除项目文件并移除 binding；`drifted` 必须确认，可以选择保留文件仅移除 binding，或走通用备份逻辑后删除文件；`missing` 可直接移除 binding。

AgentHub 覆盖项目文件前走本项目通用备份逻辑，不新增独立私有备份路径。若现有备份能力还没有公共 helper，实施时应先抽取共享备份服务，再让 AgentHub、HookHub、PluginHub 等复用同一套覆盖前保护语义。

AgentHub 的解析、转换、目标路径和预览逻辑必须集中在 server-side adapters，不散落在 UI 或 route handler。MVP adapters 为 Claude、Codex、Cursor、OpenCode、Qwen。每个 adapter 提供 native parse、native render、target path、detect 和 conversion preview 能力。同工具复用时优先保留该工具真源字段；跨工具转换时使用通用投影，不支持的字段不写入。启用、同步、覆盖前提供转换预览，MVP UI 可以只展示目标路径、动作和摘要，不强制完整 diff。

AgentHub 不做 agent JSON 导入导出。Agent 的可移植格式就是工具原生文件或 Markdown source。中心库提供打开文件和打开所在目录；后续可增加“导出为目标工具文件”的另存能力，但不是 MVP 必须项。

## User Stories

1. As a local AI tool user, I want a top-level `AgentHub` entry, so that I can manage reusable agents from one place.
2. As a local AI tool user, I want AgentHub to use an app-owned library, so that project files do not depend on the original import folder.
3. As a local AI tool user, I want built-in `agency-agents` available on first use, so that I can start with a useful agent roster without network access.
4. As a local AI tool user, I want built-in `agency-agents` to be deletable and re-importable, so that built-ins behave like ordinary installed data.
5. As a local AI tool user, I want AgentHub to keep native truth files, so that Cursor, Codex, OpenCode, Claude, and Qwen specific fields are preserved for same-tool reuse.
6. As a local AI tool user, I want AgentHub to show parsed name, description, slug, truth tool, truth role, source, and category, so that I can understand each agent without opening the file.
7. As a local AI tool user, I want to open the center native file, so that I can edit the full original agent format.
8. As a local AI tool user, I want to re-parse an edited center file, so that the list, search metadata, and generated output reflect my changes.
9. As a local AI tool user, I want name changes not to rename slug automatically, so that project target paths stay stable.
10. As a local AI tool user, I want slug renames to be explicit and preview affected projects, so that path-changing operations are clear.
11. As a local AI tool user, I want to import a local agent folder with a chosen truth tool, so that my own agent collection can enter AgentHub.
12. As a local AI tool user, I want custom local imports to scan only the folder I selected, so that unrelated repo files are not imported.
13. As a local AI tool user, I want custom local imports to scan recursively inside that folder, so that category subfolders work.
14. As a local AI tool user, I want one custom source to use one truth tool, so that parsing and conflict rules are predictable.
15. As a local AI tool user, I want local imports copied into AgentHub library, so that deleting or editing the original folder does not silently change AgentHub.
16. As a local AI tool user, I want re-importing the same local source to detect conflicts, so that existing center agents are not overwritten silently.
17. As a local AI tool user, I want AgentHub to preserve `agency-agents` category information, so that I can search and understand large rosters.
18. As a local AI tool user, I want project groups to have an `Agent` entry, so that root and subproject groups can manage their own agents.
19. As a local AI tool user, I want project Agent management to have `AgentHub Agent` and `本地 Agent` tabs, so that reusable agents and local unmanaged files are separate.
20. As a local AI tool user, I want to enable an AgentHub agent per visible target tool, so that I can avoid polluting tools I do not use.
21. As a local AI tool user, I want only convertible and project-available tools shown, so that the panel stays clean.
22. As a local AI tool user, I want enabling an agent to write that tool's native project file, so that the target tool can discover it normally.
23. As a local AI tool user, I want same-tool reuse to preserve native fields, so that a Cursor rule migrated from Cursor can be reused in another Cursor project with its rule metadata intact.
24. As a local AI tool user, I want cross-tool reuse to convert from the parsed common projection, so that one agent can still be used by different tools.
25. As a local AI tool user, I want enabling/syncing to show a target path and conversion preview, so that I know what file will be written.
26. As a local AI tool user, I want unmanaged project agent files detected, so that existing local agents can be brought under AgentHub management.
27. As a local AI tool user, I want unmanaged project agents migrated into an existing or new source, so that the center library keeps useful local work.
28. As a local AI tool user, I want migrated project agents immediately registered as managed bindings, so that the current project state becomes current instead of duplicated.
29. As a local AI tool user, I want same-path conflicts to require confirmation, so that my existing project files are not overwritten accidentally.
30. As a local AI tool user, I want unmanaged conflicts to offer migrate-then-overwrite, so that current project content can be preserved before replacement.
31. As a local AI tool user, I want project target status to show current, outdated, drifted, missing, unmanaged, or invalid, so that I know which action is safe.
32. As a local AI tool user, I want outdated targets to sync explicitly, so that center changes roll forward only when I choose.
33. As a local AI tool user, I want drifted targets skipped by batch sync, so that local project edits are not lost.
34. As a local AI tool user, I want disabling a current AgentHub target to remove the managed project file, so that the tool no longer sees that agent.
35. As a local AI tool user, I want disabling a drifted target to ask whether to keep the file or back it up and delete it, so that local modifications remain recoverable.
36. As a local AI tool user, I want AgentHub overwrites to use the project's common backup logic, so that recovery behavior is consistent with other hubs.
37. As a developer of the manager, I want AgentHub adapters per tool, so that native parsing and rendering do not leak into UI or API handlers.
38. As a developer of the manager, I want tests around center library, builtin seed, local import, adapters, project writes, local migration, status detection, backups, and sync, so that AgentHub is verified through user-visible behavior.

## Implementation Decisions

- AgentHub is an app-owned Hub with top-level center page and project-side root/subproject panels.
- AgentHub reuses SkillHub UI and behavior wherever the semantics match: source grouping, local import flow, project side tabs, project migration target choices, open file/folder, delete previews, impacted target display, compact row actions, tool checkbox behavior, bottom-right toasts, and conflict confirmation.
- AgentHub does not use SkillHub's directory link model. Project enablement writes real native agent files.
- AgentHub MVP does not manage or replace main agents. It only manages attachable units: Claude subagent, Codex custom agent, OpenCode subagent, Cursor rule, and Qwen subagent.
- AgentHub center files are native truth files. They are not normalized into a single Markdown-only file format.
- Each center agent records `sourceTruthTool`, `truthRole`, `sourceFormat`, `nativePath`, `slug`, parsed projection, native metadata, content hash, source relative path, and optional category.
- `slug` is stable and controls generated project filenames.
- Re-parsing native files can update parsed metadata but never changes slug automatically.
- Built-in `agency-agents` is a packaged source and defaults to Claude/Markdown truth.
- Built-in `agency-agents` is parsed by a dedicated built-in source adapter based on that repository's documented structure.
- AgentHub never executes `agency-agents` scripts. TypeScript adapters implement all parsing and rendering.
- MVP source types are `builtin` and `local-import`.
- Custom GitHub source is out of scope. Users who want GitHub content can clone it locally and import a local folder.
- Local-import source is an import record, not a continuing sync source.
- Local imports copy native truth files into AgentHub library and detach from the original folder afterward.
- One custom local source has one truth tool.
- Custom local source scanning is recursive inside the user-selected folder and does not scan outside it.
- AgentHub project binding scope is `projectId + targetRootPath`.
- Project target output paths are fixed per adapter:
  - Claude: `.claude/agents/<slug>.md`
  - Codex: `.codex/agents/<slug>.toml`
  - OpenCode: `.opencode/agents/<slug>.md`
  - Cursor: `.cursor/rules/<slug>.mdc`
  - Qwen: `.qwen/agents/<slug>.md`
- Project UI only shows target tools that are project-available and convertible.
- Center and project rows show lightweight truth tool and truth role labels.
- AgentHub adapters live in the server layer and expose parse, render, target path, detect, and preview behavior.
- Same-tool rendering preserves native fields from the truth file where supported.
- Cross-tool rendering uses the parsed common projection and drops unsupported fields.
- AgentHub enabling/syncing/overwriting returns a conversion preview with action, target path, and summary. Full UI diff is not required in MVP.
- AgentHub project files track both source hash and generated output hash for status detection.
- `current`, `outdated`, `drifted`, `missing`, `unmanaged`, and `invalid` are the project status vocabulary.
- Batch sync only processes `outdated` targets and skips `drifted`.
- Disabling current/outdated targets can delete managed project files.
- Disabling drifted targets must ask for confirmation and allow keeping the file while removing binding.
- Overwrites and destructive drifted disables use the project's common backup logic.
- AgentHub does not provide agent JSON import/export.

## Testing Decisions

- Tests should verify external behavior rather than implementation detail: visible center list, imported agents, generated native files, project target statuses, migration results, conflict decisions, and backup reports.
- Storage tests should cover AgentHub sources, agents, project targets, stable slug behavior, source grouping, and deletion impact.
- Built-in seed tests should cover lazy import of `agency-agents`, category/sourceRelativePath parsing, duplicate seed idempotency, delete and re-import.
- Adapter tests should cover parse and render for Claude Markdown, Codex TOML, Cursor MDC, OpenCode Markdown, and Qwen SubAgent Markdown.
- Conversion tests should cover same-tool native field preservation and cross-tool field dropping.
- Local import tests should use temporary directories with nested categories, invalid files, duplicate slugs, same-content re-import, and changed-content conflicts.
- Project API tests should cover listing project Agent state for root/subproject groups, enabling targets, disabling targets, conversion preview, same-path conflicts, unmanaged migration, and batch sync.
- Status tests should cover current, outdated, drifted, missing, unmanaged, and invalid.
- Backup tests should reuse or assert the shared project backup behavior instead of hardcoding a new AgentHub backup path.
- UI tests should cover top-level AgentHub navigation, source grouping/search, built-in empty/loaded states, project `Agent` panel, tab behavior, tool checkboxes, conflict dialogs, local migration, and sync/disable outcomes.
- File write tests should use temporary projects and data directories so no real user agent directories are mutated.

## Out of Scope

- Replacing or editing each tool's main agent.
- User-level or system-level agent directories.
- Custom GitHub source import.
- Online update checks for built-in `agency-agents`.
- Calling `agency-agents` `convert.sh`, `install.sh`, or other shell scripts.
- Aider and Windsurf merged rule-file targets.
- Gemini, Antigravity, Copilot, Kimi, OpenClaw, and other non-MVP target tools.
- Automatic slug changes when name changes.
- AgentHub-specific JSON import/export.
- Background sync from AgentHub to projects.
- Background sync from original local import folders.
- Full diff UI before applying conversions.
- Perfect byte-for-byte formatting preservation for every native file.
- Showing unavailable conversion/tool reasons in the project UI.

## Further Notes

AgentHub should be implemented as a sibling Hub to SkillHub, McpHub, HookHub, and CliHub. The product shell and project-side interaction should copy SkillHub where possible, but the writeback model should follow HookHub's managed-file status thinking because AgentHub writes real native files rather than links.

The highest-risk implementation point is ownership: after import, AgentHub library owns the native truth file; after project enablement, ProjectAgentTarget owns only the generated output file it recorded. External import folders and unmanaged project files must not be treated as owned until explicitly imported or migrated.
