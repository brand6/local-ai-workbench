Status: ready-for-human

# PRD: SkillHub 技能分发中心与项目规则同步

## Problem Statement

用户在本机维护多套 agent skill，技能可能来自本地目录或 GitHub 仓库。当前项目已经有项目、工具、会话管理能力，但不再通过 `amtiYo/agents` CLI 管理项目技能或规则文件；技能需要作为一等资源在应用内管理：有中心技能库，有项目级技能分发界面，并能按项目工具创建和删除技能链接。

现状下，用户需要手动把同一批技能复制或链接到不同项目、不同工具目录里。GitHub 技能仓库更新时，用户也需要手动判断哪些技能新增、删除、移动或变更。多个来源里可能存在同名技能，SkillHub 应允许它们共存，但项目工具目录内的技能文件夹是扁平结构，不能同时存在同名 link。

规则文件也存在类似的工具分散问题。Codex、OpenCode、Qwen、Qoder、Copilot 等工具可使用 `AGENTS.md`，Claude Code 使用 `CLAUDE.md`。规则文件不负责技能发现，但用户希望在项目详情页手动同步 `AGENTS.md` 和 `CLAUDE.md`，并且在覆盖前尽量保留可恢复点。

## Solution

在当前本地项目管理器中新增 SkillHub。SkillHub 是应用自有的技能分发中心，不依赖 `skills-manager` 或 `amtiYo/agents` 作为核心运行时。SkillHub 参考 `skills-manager` 的中心库、来源、更新检查和项目选择体验；项目技能分发和规则文件同步参考 `amtiYo/agents` 的工具映射思路，但由本项目自己实现。

SkillHub 默认把实际技能文件保存在当前应用数据目录下，例如 `<dataDir>/skillhub/library`，并在设置里允许用户修改技能中心目录。SkillHub 内部拥有技能真实文件：本地导入会复制技能目录到 SkillHub，GitHub 导入会把仓库内容克隆或物化到 SkillHub。项目内只创建一层 link，指向 SkillHub library 里的真实技能目录。Windows 默认使用 directory junction，非 Windows 使用 symlink；失败时提示错误，不做 copy fallback。

SkillHub 支持同名技能。每个技能用内部 `skillId` 标识，并记录 `sourceId`、来源类型、GitHub `owner-repo`、library 相对路径、当前本地路径、技能文件夹名、`SKILL.md` 的 `name` 和 `description`。项目工具目录内不支持同名技能；当用户选择另一个同名技能时，界面提示当前 link 指向和新技能来源，并让用户选择是否替换 link。

主界面顶栏左侧新增 `SkillHub` 入口。SkillHub 页面展示所有中心库技能、library 相对路径、来源信息、添加技能、删除技能、检查更新和 GitHub source 更新操作。项目详情页“刷新项目”按钮旁边新增“技能”入口，打开右侧项目技能管理面板。面板按技能显示主勾选框和展开操作：主勾选对项目启用的全部工具生效；展开后可单独控制工具；部分工具生效时主勾选框显示 indeterminate。

项目需要维护启用的 agent tools。新建项目时让用户选择项目使用哪些工具；旧项目根据已有会话 `toolId` 和项目结构痕迹自动推断并默认启用。启用只影响项目技能管理界面显示的目标工具，不会自动创建技能链接。真正创建和删除 link 只发生在用户进入项目技能管理并勾选或取消技能时。

GitHub 来源支持手动检查更新。SkillHub 页面提供“检查更新”按钮，检查所有 GitHub sources。更新按 source 执行，不支持同一个 source 下只更新部分技能；UI 按 source 展示新增、变更、删除、目录迁移的技能，以及受影响项目和工具。GitHub 目录迁移优先通过 Git rename 检测；检测到迁移时保留 `skillId`，更新 library 里的真实技能目录和路径映射。项目 link 仍指向稳定的 SkillHub library 目录，通常不需要重建。若更新会删除已分发技能，必须作为破坏性更新展示并确认；确认后删除对应项目 link，避免断链。

规则同步是独立的项目级功能，不参与技能发现。项目详情页顶部按钮区新增“规则同步”，点击后打开 modal。MVP 只维护 `AGENTS.md` 和 `CLAUDE.md` 两个文件。用户选择同步方向：`AGENTS.md -> CLAUDE.md` 或 `CLAUDE.md -> AGENTS.md`。源文件不存在时对应方向禁用；两个文件都不存在时只显示文件状态，不提供创建规则文件。目标文件存在且内容不同并位于 Git 仓库内时，若目标规则文件有未提交内容，系统只 stage/commit 该规则文件，commit 信息为 `chore: 同步规则前备份 <file>`，然后静默覆盖。目标文件在 Git 仓库内但无未提交内容时静默覆盖。目录没有 Git 管理但 `git` 可用时，询问用户是否初始化 Git 并提交规则文件；`git` 不可用时询问用户是否直接覆盖。

## User Stories

1. As a local AI tool user, I want a `SkillHub` entry in the top bar, so that I can manage all local skills from one place.
2. As a local AI tool user, I want SkillHub to store skills under the app data directory by default, so that the manager owns the skill library.
3. As a local AI tool user, I want to configure the SkillHub directory in settings, so that I can choose where skill files live.
4. As a local AI tool user, I want SkillHub to show skills grouped and sorted by library relative path, so that source and category context are visible.
5. As a local AI tool user, I want to search by folder name, `SKILL.md` name, description, relative path, and source, so that I can find skills quickly.
6. As a local AI tool user, I want to import a local single skill directory, so that I can add one skill into SkillHub.
7. As a local AI tool user, I want to import a local `skills` directory, so that each skill under that directory is copied into `library/skills`.
8. As a local AI tool user, I want to import a local parent directory that contains a `skills` directory, so that the source structure is preserved under `library/<group>/skills`.
9. As a local AI tool user, I want `skills` to be treated as a special wrapper name, so that selecting `skills` does not create `library/skills/skills`.
10. As a local AI tool user, I want SkillHub to copy local imports into the library, so that deleting or moving the original local folder does not break projects.
11. As a local AI tool user, I want SkillHub to import GitHub sources from `owner/repo`, GitHub URLs, tree URLs, and SSH URLs, so that common GitHub input formats work.
12. As a local AI tool user, I want GitHub sources to use `owner-repo` as the library group, so that source paths are readable.
13. As a local AI tool user, I want re-importing the same GitHub `owner-repo` to merge new skills and request confirmation for overwrites, so that duplicate source namespaces stay coherent.
14. As a local AI tool user, I want SkillHub to accept only directories containing `SKILL.md` as skills, so that invalid folders are skipped.
15. As a local AI tool user, I want parent skill directories to win over nested `SKILL.md` files, so that old backups or examples inside a skill are not imported as separate skills.
16. As a local AI tool user, I want SkillHub to support multiple skills with the same folder name, so that different sources can provide their own version of a skill.
17. As a local AI tool user, I want project skill links to use only the final skill folder name, so that tool skill directories remain flat.
18. As a local AI tool user, I want project skill selection to display the SkillHub library relative path, so that I can distinguish same-name skills.
19. As a local AI tool user, I want project tool targets to be inferred from existing sessions and project traces, so that old projects work without manual setup.
20. As a local AI tool user, I want inferred tool targets to be enabled by default, so that the project skill UI immediately reflects known tool usage.
21. As a local AI tool user, I want new project creation to allow selecting agent tools, so that SkillHub knows where project skills can be distributed.
22. As a local AI tool user, I want the project skill panel beside the project detail page, so that I can manage skills without leaving the project context.
23. As a local AI tool user, I want checking a skill to enable it for all enabled tools by default, so that common multi-tool projects are fast to configure.
24. As a local AI tool user, I want to expand a skill and choose specific tools, so that I can limit a skill to selected agents.
25. As a local AI tool user, I want the skill checkbox to show indeterminate when only some tools use it, so that partial distribution is visible.
26. As a local AI tool user, I want canceling a skill to delete its links from all target tools, so that the project no longer exposes that skill.
27. As a local AI tool user, I want canceling one tool target to delete only that tool's link, so that other tools can keep using the skill.
28. As a local AI tool user, I want choosing a same-name skill to offer link replacement, so that I can switch project tools from one source to another.
29. As a local AI tool user, I want project links to be directory junctions on Windows and symlinks elsewhere, so that projects contain links rather than copies.
30. As a local AI tool user, I want link creation failure to be visible, so that I can fix permissions or path issues instead of getting silent copies.
31. As a local AI tool user, I want deleting a SkillHub skill to show affected projects and tools, so that I know what links will be removed.
32. As a local AI tool user, I want confirmed SkillHub deletion to remove all project links first, so that projects do not keep broken links.
33. As a local AI tool user, I want a SkillHub “检查更新” button, so that GitHub checks happen only when I ask.
34. As a local AI tool user, I want GitHub updates grouped by source, so that one repository updates as a coherent unit.
35. As a local AI tool user, I want update previews to show added, changed, deleted, and moved skills, so that I understand source impact before applying it.
36. As a local AI tool user, I want GitHub directory moves to keep the same `skillId`, so that distributed skills remain conceptually the same skill.
37. As a local AI tool user, I want destructive updates to show affected project links, so that I can decide whether to remove them.
38. As a local AI tool user, I want rules sync as a project detail button, so that it is available where project rules are managed.
39. As a local AI tool user, I want rules sync to cover only `AGENTS.md` and `CLAUDE.md`, so that no third center rule file is introduced.
40. As a local AI tool user, I want to choose `AGENTS.md -> CLAUDE.md` or `CLAUDE.md -> AGENTS.md`, so that I decide which file is truth.
41. As a local AI tool user, I want sync directions with missing source files disabled, so that I cannot copy from nothing.
42. As a local AI tool user, I want existing Git-managed target rules to be recoverable after overwrite, so that manual sync is low friction.
43. As a local AI tool user, I want only the target rule file committed before overwrite, so that unrelated work is never committed by rule sync.
44. As a local AI tool user, I want non-Git projects to ask before initializing Git or overwriting, so that unmanaged files are not silently destroyed.
45. As a developer of the manager, I want SkillHub, tool targets, skill links, GitHub sources, and rule sync to be app-owned modules, so that the app no longer relies on `skills-manager` or `amtiYo/agents`.

## Implementation Decisions

- SkillHub is implemented inside this app. `skills-manager` and `amtiYo/agents` are references only, not runtime dependencies.
- SkillHub default root is `<dataDir>/skillhub`; the default library is `<dataDir>/skillhub/library`.
- Settings exposes a configurable SkillHub directory. Changing it must be explicit and should not silently move existing skills in MVP.
- SkillHub library contains real skill directories, not internal links.
- Project tool skill directories contain links to SkillHub library directories. Links are one layer deep from project to library.
- Windows uses directory junctions for project skill links. Non-Windows uses symlinks. There is no copy fallback.
- Skill identity uses an internal `skillId`; folder name and library relative path are display and location fields, not global identity.
- SkillHub supports same-name skills across different sources.
- Project tool skill directories are flat and do not support duplicate link names.
- Same-name project conflicts are resolved by an explicit replace-link flow.
- Skill validity is `SKILL.md` only. Lowercase `skill.md` is out of scope.
- Source scanning is parent-first. Once a directory is identified as a skill, nested `SKILL.md` files are not imported as separate skills.
- Local import copies files into SkillHub and does not retain the original folder as a runtime dependency.
- Local imports treat `skills` as a special wrapper. Selecting a `skills` directory imports its contents under `library/skills`; selecting the parent preserves the parent group under `library/<group>/skills`.
- GitHub imports use `owner-repo` as `repoKey`. The same `owner-repo` source namespace is merged or overwritten with user confirmation; it does not create hash-suffixed duplicates by default.
- GitHub input supports `owner/repo`, `owner/repo/path`, full GitHub URL, GitHub tree URL with branch and path, and SSH URL.
- GitHub update checks are manual and source-level.
- GitHub update previews detect added, changed, deleted, and moved skills. Git rename detection is the first migration signal; same folder name is a fallback migration candidate.
- Source updates write updated skill content into stable SkillHub library locations. Project links should not require rebuilding when only source relative paths change.
- New project creation gains an agent tool selection step.
- Existing projects infer enabled tools from session `toolId` values and project structure traces. Inferred enabled tools only affect display and target defaults; they do not create links.
- Project skill management opens as a right-side panel from the project detail page next to the refresh action.
- SkillHub opens as an independent page from a top-bar `SkillHub` entry.
- Rule sync is independent from skill distribution.
- Rule sync only manages `AGENTS.md` and `CLAUDE.md`.
- Rule sync has no hard canonical source. The user chooses sync direction each time.
- Rule sync protects Git-managed target files by committing only the target rule file before overwrite when it has uncommitted changes.
- Rule sync commit message format is `chore: 同步规则前备份 <file>`.

## Testing Decisions

- Tests should exercise externally visible behavior: imported skills appear in SkillHub, project links are created and removed, update previews classify source changes, and rule sync writes or protects files as specified.
- Storage tests should cover SkillHub root configuration, source records, skill records, project tool targets, project skill targets, and reference scans.
- Import tests should use temporary directories with representative structures: single skill directory, `skills` directory, parent containing `skills`, nested `SKILL.md`, duplicate folder names, and invalid `SKILL.md` positions.
- GitHub tests should use local Git fixtures where possible instead of network-dependent tests, including rename detection and deleted distributed skills.
- Link tests should verify target paths, no-copy behavior, replacement behavior, and deletion behavior. Windows junction behavior should be covered on Windows; non-Windows symlink behavior should be covered by platform-conditional tests.
- API tests should cover SkillHub list/import/delete/check-update/update flows, project tool target list/update flows, project skill target update flows, and rule sync status/apply flows.
- UI tests should cover SkillHub entry and list, add skill flow, project skill panel checkbox/indeterminate behavior, same-name replacement prompt, update status display, and rule sync modal behavior.
- Rule sync tests should cover source missing direction disabled, existing same content no-op, Git-managed dirty target checkpoint commit, Git-managed clean target overwrite, non-Git prompt branch, and `git` unavailable prompt branch.
- End-to-end smoke verification should run against a temporary data directory and temporary project directories so no real user skill library or rule files are mutated.

## Out of Scope

- Runtime dependency on `skills-manager`.
- Runtime dependency on `amtiYo/agents` for SkillHub or rule sync.
- Ordinary URL imports.
- `.zip` or `.skill` archive imports.
- Lowercase `skill.md`.
- Hidden or disabled SkillHub skills.
- Project-internal skill aliases or automatic rename of same-name skills.
- Copy fallback when link creation fails.
- Background GitHub update checks.
- Partial updates within one GitHub source.
- Automatic rule sync.
- Merge editing or semantic reconciliation between `AGENTS.md` and `CLAUDE.md`.
- Managing `QWEN.md`, `OPENCODE.md`, `QODER.md`, `.github/copilot-instructions.md`, `.cursorrules`, `GEMINI.md`, or other rule files in MVP.
- MCP configuration sync.

## Further Notes

旧 `agents` CLI 配置同步入口已经移除。SkillHub、项目技能分发和规则同步继续由本应用自己的模块负责，不调用 `amtiYo/agents` 作为运行时依赖。

The project tool skill directory mapping should live in this app's tool adapter layer. Do not guess unsupported paths silently; if a tool does not have a verified project skill directory, the project skill UI should show it as unsupported for skill distribution until the mapping is implemented and tested.
