Status: ready-for-human

# PRD: CliHub CLI 生命周期管理中心

## Problem Statement

用户在本机同时使用多种 CLI：一类是 Codex、Claude、OpenCode、Qwen、Qoder、Copilot 这类项目会话工具；一类是 `lark-cli`、`gh`、`playwright` 这类为应用提供额外能力的功能 CLI；还有 `node`、`npm`、`git` 这类基础依赖。当前应用只能在工具 adapter 中用命令名粗略检测会话工具是否存在，不能集中展示 CLI 的安装来源、版本、更新状态和安装方式。

用户希望新增一个顶层 `CliHub`，统一管理 CLI 的安装、发现和更新。CliHub 需要和 `SkillHub`、`McpHub`、`HookHub` 同级出现，但它管理的是 CLI 生命周期底座，不替代现有业务 Hub。对于已经存在的本地 CLI，应用应优先使用现有安装，不额外安装第二份不同 provider 的同名 CLI。对于 `lark-cli`、`playwright` 这类非项目工具 CLI，CliHub 只提供额外功能依赖，不影响项目内可选工具。

## Solution

新增顶层 `CliHub` 页面。CliHub 维护一个 CLI 清单和本地发现结果，支持内置 CLI 与用户自定义 CLI。内置 CLI 提供尽量多的可靠安装渠道；用户自定义 CLI 只支持两种添加方式：本地可执行文件路径，或一条可结构化解析的网上安装命令。

CliHub 第一版不提供卸载。它支持：

- 发现本地 CLI 是否可用、实际路径、版本和可能来源。
- 按内置或用户配置的安装渠道安装 CLI。
- 用户显式点击后检查 CLI 是否有更新。
- 对有明确同 provider 更新语义的 CLI 执行更新。
- 在安装由 CliHub 自己管理的 GitHub release 类二进制时，把 `<dataDir>/clihub/shims` 写入用户级 `PATH`，并同步追加到当前应用进程 `PATH`。

CliHub 不改写 `AppConfig.tools.command`。现有项目工具逻辑保持不变。会话工具是否可用仍以现有 adapter 和命令可执行性为基础；CliHub 安装或外部安装后，刷新发现结果即可让当前可用性反映到界面。项目保存的工具偏好不因 CLI 不可用而被删除；不可用只表现为当前操作禁用或状态提示。自定义项目工具第一版不进入项目页，不参与历史扫描、恢复、SkillHub、McpHub 或 HookHub。

CliHub 内置第一版清单：

- 项目工具 CLI：`codex`、`claude`、`opencode`、`qwen`、`qoder`、`copilot`
- 功能 CLI：`lark-cli`、`gh`、`playwright`
- 依赖 CLI：`node`、`npm`、`git`

内置 CLI 的安装渠道由内置清单提供，可以包含 `npm`、`github-release`、`winget`、`choco`、`scoop`、`installer-command` 等。用户可以为内置 CLI 追加新的安装渠道。用户自定义 CLI 如果使用本地路径，必须验证路径存在，只做发现和使用，不支持更新。用户自定义 CLI 如果使用网上安装命令，系统只解析单条可结构化命令；复杂 shell、管道、重定向、`cmd /c`、`powershell -Command`、`curl | sh`、`iwr | iex` 等不由应用自动执行。

## User Stories

1. As a local AI tool user, I want a top-level `CliHub` entry, so that I can manage CLI availability from the same navigation level as SkillHub, McpHub, and HookHub.
2. As a local AI tool user, I want CliHub to list all built-in project tool CLIs, so that I can see which agent tools are installed on this machine.
3. As a local AI tool user, I want CliHub to list function CLIs such as `lark-cli`, `gh`, and `playwright`, so that extra app features can explain their dependencies.
4. As a local AI tool user, I want CliHub to list dependency CLIs such as `node`, `npm`, and `git`, so that missing prerequisites are visible.
5. As a local AI tool user, I want CliHub to discover local CLI paths and versions, so that I understand what the app can currently run.
6. As a local AI tool user, I want version detection failure not to mark a CLI unusable, so that tools with unusual version output still work.
7. As a local AI tool user, I want CliHub to prefer existing local CLI installations, so that it does not install a second copy of a CLI I already have.
8. As a local AI tool user, I want CliHub to avoid installing a second provider for an already available CLI, so that PATH and update behavior remain predictable.
9. As a local AI tool user, I want CliHub to infer high-confidence providers from local paths when possible, so that existing installs can be updated without manual re-entry.
10. As a local AI tool user, I want low-confidence provider guesses to require confirmation, so that CliHub does not update the wrong package.
11. As a local AI tool user, I want PATH-discovered CLIs with unknown provider to remain usable, so that missing source metadata does not block work.
12. As a local AI tool user, I want internal project tool preferences to remain unchanged when a CLI becomes unavailable, so that reinstalling the CLI restores the previous project behavior.
13. As a local AI tool user, I want `lark-cli` and `playwright` to be tracked as function CLIs, so that Feishu and browser verification features can depend on them without making them project tools.
14. As a local AI tool user, I want built-in CLIs to have multiple install channels where reliable, so that I can choose the provider that fits my machine.
15. As a local AI tool user, I want dependency CLIs to offer installation and update when a command provider is available, so that setup blockers can be resolved from one place.
16. As a local AI tool user, I want no CLI uninstall button in the first version, so that CliHub cannot accidentally remove shared system tools.
17. As a local AI tool user, I want custom CLI registration by local executable path, so that internal or manually installed tools can be tracked.
18. As a local AI tool user, I want custom CLI registration by online install command, so that official installation instructions can become a managed channel.
19. As a local AI tool user, I want custom local-path CLIs to be non-updatable, so that CliHub does not invent update behavior for manually installed binaries.
20. As a local AI tool user, I want custom install commands to be parsed into known providers where possible, so that installation and update commands are structured rather than arbitrary shell.
21. As a local AI tool user, I want custom installer commands to require a single structured command, so that unsafe pipe or script execution is not hidden inside the app.
22. As a local AI tool user, I want CliHub to reject custom CLI input that is only a command name, so that every custom CLI has a concrete local path or install source.
23. As a local AI tool user, I want update checks to run only when I click a button, so that CliHub does not do slow or network-heavy checks in the background.
24. As a local AI tool user, I want update status to be `up-to-date`, `update-available`, or `unknown`, so that failed checks are distinguishable from current packages.
25. As a local AI tool user, I want updates to be same-provider only, so that an npm install is updated by npm and a winget install is updated by winget.
26. As a local AI tool user, I want installation and update operations to run one at a time, so that package managers do not conflict with each other.
27. As a local AI tool user, I want background operations to show a visible status, so that leaving the CliHub page does not make installs feel lost.
28. As a local AI tool user, I want each CLI to show its most recent operation result, so that failures include an actionable error summary.
29. As a local AI tool user, I want CliHub operations to refresh discovery afterward, so that the UI reflects newly installed or updated CLIs.
30. As a local AI tool user, I want CliHub-managed GitHub release binaries to live under the app data directory, so that their ownership is clear.
31. As a local AI tool user, I want CliHub shims added to my user PATH only after CliHub installs a managed binary, so that existing CLI setups are not modified unnecessarily.
32. As a local AI tool user, I want provider-installed CLIs to stay in provider-managed locations, so that CliHub does not copy or relocate npm, winget, choco, or scoop installs.
33. As a developer of the manager, I want CliHub to keep CLI lifecycle data separate from `AppConfig.tools.command`, so that existing launch configuration remains compatible.
34. As a developer of the manager, I want CliHub not to modify project detail behavior in MVP, so that current project tool, session, SkillHub, McpHub, and HookHub flows remain stable.
35. As a developer of the manager, I want custom project-tool adapters to be out of scope for this slice, so that launch-only or advanced adapter design can be handled separately.

## Implementation Decisions

- CliHub is a top-level Hub page, but its domain is CLI lifecycle management rather than project-scoped configuration.
- CliHub does not replace SkillHub, McpHub, HookHub, or the existing project tool adapter model.
- CliHub first version does not provide uninstall for any CLI.
- `AppConfig.tools.command` keeps its current meaning and is not rewritten by CliHub.
- CliHub stores CLI inventory, source/channel metadata, discovery result, update status, and most recent operation result in app-owned data.
- The app data directory is the manager's data directory, not an individual managed project root.
- CliHub-managed GitHub release binaries live under `<dataDir>/clihub`.
- CliHub shims live under `<dataDir>/clihub/shims`.
- The shims directory is added to user-level `PATH` only after CliHub installs a managed binary that needs a shim.
- The current app process PATH is updated immediately after PATH write so the app can discover the new command without restart.
- Provider installs for `npm`, `winget`, `choco`, `scoop`, and `installer-command` use provider defaults and are not copied into CliHub-managed directories.
- Existing local CLI availability blocks installing a second provider copy for the same CLI.
- Existing local CLI discovery may infer provider candidates from path shape and provider queries.
- High-confidence provider matches may be recorded automatically; low-confidence matches require user confirmation before update is enabled.
- PATH-discovered CLIs with unknown source remain available but are not updatable.
- Version detection failure stores an unknown version state but does not make a CLI unavailable.
- Built-in CLI channels can include multiple providers when reliable package ids or install commands are known.
- Users can add channels to built-in CLIs.
- User custom CLI creation supports only local executable path or online install command.
- A custom CLI cannot be created from a bare command name.
- Local-path custom CLIs are not updatable.
- Custom online install commands must parse into a known provider or a single structured installer command.
- Complex shell commands are rejected for automatic execution.
- Update checks are explicit user actions, either per CLI or for all visible CLIs.
- Update check status is stored as `up-to-date`, `update-available`, or `unknown`.
- Updates are same-provider only.
- Installs, update checks, and updates run through a global serial operation queue in MVP.
- The app shows an operation banner while a CliHub action is running.
- CliHub stores only the most recent operation result per CLI, not a full historical log.
- Custom project-tool CLI support in project detail is out of scope for this PRD.
- Future complete project tool support should add a real Tool Adapter together with a CliHub built-in entry.

## Testing Decisions

- Tests should verify user-visible behavior at storage, API, provider parsing, discovery, PATH handling, and UI seams.
- Storage tests should cover built-in CLI records, custom CLI records, channel metadata, discovery status, update status, and recent operation result.
- Provider parsing tests should cover supported npm, winget, choco, scoop, and installer-command shapes, plus rejected complex shell commands.
- Discovery tests should cover available commands, missing commands, version success, version failure, unknown provider, and high-confidence provider inference.
- PATH tests should use temporary environment values and verify user PATH writes are deduplicated and only attempted after managed binary install.
- API tests should cover listing CliHub, refreshing discovery, adding custom local-path CLI, adding custom install-command CLI, checking updates, installing, and updating.
- UI tests should cover top-level CliHub navigation, grouped CLI rows, custom add flow, explicit update check, running operation banner, and recent result display.
- Existing project detail tests should keep current behavior stable; CliHub should not require project detail rewrites in MVP.
- Tests should avoid real package manager network calls by using command runner fakes and fixtures.

## Out of Scope

- CLI uninstall.
- Automatically installing a second provider copy for an already available CLI.
- Automatically switching providers for an installed CLI.
- Background update checks.
- Unified latest-version comparison beyond explicit provider-specific update checks.
- Running arbitrary shell scripts, pipes, redirections, `cmd /c`, `powershell -Command`, `curl | sh`, or `iwr | iex` from custom channels.
- Provider search from a bare command name.
- Creating custom CLI from only a command name.
- Modifying `AppConfig.tools.command`.
- Replacing the existing Tool Adapter model.
- Adding custom project-tool CLIs to project detail.
- Launch-only custom project tools.
- Advanced custom adapters for history scanning, resume, SkillHub, McpHub, or HookHub.
- Feishu document or Base synchronization; this PRD only makes `lark-cli` manageable as a function CLI dependency.
- Long-term operation log history.
- System-level PATH writes.

## Further Notes

`CliHub` should be treated as a foundation for later Feishu and other CLI-backed features. `lark-cli` belongs in CliHub as a function CLI, but FeishuSync or other Feishu workflows should be designed as separate features that depend on CliHub's availability signal.
