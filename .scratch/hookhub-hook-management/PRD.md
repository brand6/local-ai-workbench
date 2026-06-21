Status: ready-for-human

# PRD: HookHub Hook 套件管理与项目分发

## Problem Statement

用户在本机同时使用 Claude Code、Codex、OpenCode、Qwen、Qoder、Copilot 等多个 AI coding 工具。这些工具的 hook 和 MCP 不同：MCP 可以抽象成中心 server 定义后分发；hook 则是每个工具原生提供的生命周期配置能力，配置位置、事件、matcher、handler 类型、输出控制和信任模型都不同。

Hook 也不适合按“单个 hook 组件”管理。一个功能往往需要一整套触发配置，例如同一个安全检查可能同时覆盖 shell、编辑、patch 等多个入口。用户关心的是“这个项目的 Claude 现在启用了哪套 hooks”、“这套 hooks 能否复用到另一个项目”，而不是维护每条原生 hook 的独立身份。

项目当前已经有顶层 `SkillHub`、`McpHub` 入口，以及项目详情中按 root/subproject group 打开的侧边管理面板。HookHub 需要沿用这个项目/子项目语义，但产品模型应调整为：HookHub 管理可复用 hook suite；项目侧按 `project/group + tool` 管理当前工具的一整套 hooks。一个项目 group 内的一个工具只能启用一套 HookHub suite。

## Solution

新增 `HookHub`。顶层 `HookHub` 是 hook suite 复用库。一个 suite 有稳定 `suiteId` 和全局唯一 `name`，并可包含多个工具的 hooks payload，例如 Claude hooks、CodeBuddy hooks、Codex hooks、Qwen hooks、Qoder hooks。`name` 是用户识别和选择 suite 的主要字段，必须全局唯一，但内部绑定仍使用 `suiteId`，所以改名不会破坏项目绑定。

HookHub 支持从 0 结构化创建和编辑一套完整 suite。Suite 可以一开始只包含一个工具的 hooks payload，之后在 HookHub 内继续补其它工具 payload。HookHub 也支持显式分发：用户选择 suite、项目 root/subproject group、目标工具和 scope 后，应用该 suite 对应工具的 hooks payload。

项目详情中的每个 root/subproject group 新增 `Hooks` 入口。项目 Hook 管理器按工具展示当前 group 的 hooks section，并提供结构化编辑能力。项目侧新建 hooks 时也创建 HookHub suite，然后立即应用到当前 `project/group + tool`。当前项目只是第一个启用实例，用户可以继续在项目侧测试和修改；如果项目 hooks 和 HookHub suite 不一致，则通过 drift 状态处理。

HookHub 的应用语义是成套覆盖，不做单条 hook 勾选：

- 每个 `project/group + tool` 只能绑定一套 suite。
- 应用 suite 时，只覆盖目标工具配置文件里的 `hooks` 部分，保留同文件中的其它 settings。
- 同一个 group 可以分别为 Claude、Codex、Qwen、Qoder 启用不同 suite。
- 同一 suite 可以包含多个工具 payload；应用时只写目标工具自己的 hooks section。
- 如果目标项目工具已有另一套 suite，应用新 suite 会替换旧 suite 的 binding 和 hooks section。

项目侧可以把当前工具的一套 hooks 上传到 HookHub。上传范围是当前 `project/group + tool` 的 hooks section，不会自动合并当前 group 的其它工具 hooks。上传后创建一个新的 HookHub suite，初始只包含当前工具 payload，但该 suite 后续仍可扩展成多工具 suite。Suite name 必须全局唯一。

状态判断按 hooks section 快照，而不是靠用户可见版本号。Binding 记录 `suiteId`、`projectId`、`targetRootPath`、`toolId`、`configPath`、`scope`、上次应用的 hooks payload fingerprint 和 applied time。扫描当前项目时：

- `current`：项目当前 hooks section 和上次应用内容一致，且 HookHub 当前渲染内容也一致。
- `outdated`：项目当前 hooks section 没有本地修改，但 HookHub suite 的目标工具 payload 已更新。
- `drifted`：项目当前 hooks section 和上次应用内容不一致，代表本地有修改。
- `missing`：binding 还在，但项目 hooks section 已为空或目标配置缺失。
- `unmanaged`：项目工具有 hooks section，但没有 HookHub binding。
- `invalid`：目标配置无法解析或 hooks section 无法结构化读取。

`outdated` 可以批量同步；`drifted` 批量同步时跳过，必须在单个项目工具里处理。Drifted 项目工具提供三类动作：用当前 hooks 覆盖原 suite、把当前 hooks 另存为新 suite、从 HookHub 同步覆盖项目。`missing` 可以从 HookHub 同步恢复，也可以移除 binding，因为本地已经没有 hook。`unmanaged` 不提供直接清空 hooks，避免不可恢复删除；如果应用 suite，会提供覆盖、先上传当前 hooks 再覆盖、取消。

HookHub suite 更新后，HookHub 页面支持“同步到所有已启用项目”。这里的“所有项目”只指已有 binding 的 `project/group + tool`，不会给未启用该 suite 的项目新增 hooks。批量同步只覆盖 `outdated`，跳过 `drifted` 并在结果中列出。项目侧也支持更新当前 group/tool 的单个 suite，或更新当前项目内所有不一致 hooks；这些动作也只处理已有 binding。

覆盖 hooks section 前必须可恢复：

- 如果目标配置文件在 Git repo 中且 Git-managed dirty，沿用规则同步思路，只 stage/commit 目标配置文件，commit message 为 `chore: HookHub 覆盖前备份 <file>`。
- 如果目标配置文件在 Git repo 中且 Git-managed clean，直接覆盖，因为 Git 历史可恢复。
- 如果项目是 Git repo 但目标配置文件 untracked，提供额外提交按钮；默认仍做本地备份，不自动把 local-only 配置加入 Git。
- 如果不是 Git-managed 可恢复场景，在项目内写本地备份，例如 `.hookhub/backups/<timestamp>/...`。
- 本地备份保存整个配置文件，metadata 标明本次操作只覆盖 `hooks` section。

MVP 优先支持项目级 Claude Code、CodeBuddy Code、Codex、Qwen、Qoder hook 配置：

- `claude`：读取和写入 `<groupPath>/.claude/settings.json` 或 `<groupPath>/.claude/settings.local.json` 的 `hooks`。
- `codebuddy`：读取和写入 `<groupPath>/.codebuddy/settings.json` 或 `<groupPath>/.codebuddy/settings.local.json` 的 `hooks`；payload 采用 CodeBuddy 官方 Claude Code Hooks 兼容格式。
- `codex`：优先读取和写入 `<groupPath>/.codex/hooks.json`。
- `qwen`：读取和写入 `<groupPath>/.qwen/settings.json` 或 `<groupPath>/.qwen/settings.local.json` 的 `hooks`。
- `qoder`：读取和写入 `<groupPath>/.qoder/settings.json` 或 `<groupPath>/.qoder/settings.local.json` 的 `hooks`。

`opencode` 和 `copilot` 放在后续适配。OpenCode hook 本质是 JS/TS plugin 文件和 `opencode.json` plugin 列表，不能简单当作 JSON hooks section；Copilot 同时有 CLI、repo hook file 和 cloud agent sandbox 差异，需要单独展示执行环境限制。

HookHub 支持导入和导出：

- `导入 HookHub suite`：严格接受 HookHub 自己导出的 suite JSON。遇到同名 suite 时提供覆盖已有 suite、重命名后导入为新 suite、取消。
- `导入工具原生 hooks`：用户选择工具，粘贴或选择 Claude settings、Codex hooks.json、Qwen/Qoder settings 等原生配置；HookHub 只抽取该工具 hooks section，并创建新的 suite，不支持导入到已有 suite。
- 导出 HookHub suite 时只包含 suite metadata 和各工具 hooks payload，不包含项目 binding 信息。

HookHub 不保存真实 secret，不写系统或用户级环境变量。结构化表单只记录需要的环境变量名和变量引用。HTTP hooks 应有风险提示；命令 hooks 显示最终命令、工作目录、timeout 和作用域。HookHub 不负责绕过 Codex、Claude 或其它工具自身的 hook trust/review 流程，只负责生成正确的项目配置。

## User Stories

1. As a local AI tool user, I want a top-level `HookHub` entry, so that I can manage reusable hook suites from one place.
2. As a local AI tool user, I want HookHub suite names to be globally unique, so that I can identify a suite without ambiguity.
3. As a local AI tool user, I want a suite to support multiple tools, so that one reusable idea can carry Claude, CodeBuddy, Codex, Qwen, and Qoder hooks.
4. As a local AI tool user, I want to create a suite from 0 in HookHub, so that stable hooks can be prepared before choosing a project.
5. As a local AI tool user, I want to edit a suite in HookHub, so that its tool payloads can evolve over time.
6. As a local AI tool user, I want project groups to have a `Hooks` entry, so that I can manage hooks for the exact root/subproject directory where tools run.
7. As a local AI tool user, I want each project group and tool to have at most one active hook suite, so that hook state is simple and predictable.
8. As a local AI tool user, I want project Hook management to show the current hooks section for each tool, so that I understand what is actually configured.
9. As a local AI tool user, I want project Hook management to expose statuses like `current`, `outdated`, `drifted`, `missing`, `unmanaged`, and `invalid`, so that I know what action is safe.
10. As a local AI tool user, I want to create hooks from the project panel and have that create a HookHub suite, so that local testing still produces reusable configuration.
11. As a local AI tool user, I want project-side editing to modify the project hooks first, so that I can test changes before deciding whether to update HookHub.
12. As a local AI tool user, I want drifted hooks to offer updating the original suite, saving as a new suite, or restoring from HookHub, so that local changes are not accidentally lost.
13. As a local AI tool user, I want unmanaged hooks to be uploadable to HookHub, so that existing local configuration can become reusable.
14. As a local AI tool user, I want unmanaged hooks not to have a direct clear action, so that destructive deletion is avoided.
15. As a local AI tool user, I want applying a suite to unmanaged hooks to offer overwrite, upload-then-overwrite, or cancel, so that existing local hooks are recoverable.
16. As a local AI tool user, I want applying suite B over bound suite A to replace the whole tool hooks section, so that only one suite controls that project tool.
17. As a local AI tool user, I want applying a suite to preserve unrelated settings in the same config file, so that MCP, permissions, models, or other settings are not destroyed.
18. As a local AI tool user, I want HookHub to back up or checkpoint config files before replacement, so that overwritten hooks can be recovered.
19. As a local AI tool user, I want Git-managed dirty config files to be committed before replacement, so that recovery is clear and scoped.
20. As a local AI tool user, I want non-Git config files to be backed up inside the project, so that recovery does not depend on external state.
21. As a local AI tool user, I want HookHub suite updates to mark existing bindings as outdated, so that I know which projects can be refreshed.
22. As a local AI tool user, I want HookHub to sync a changed suite to all already-enabled projects, so that common hooks can be rolled forward explicitly.
23. As a local AI tool user, I want batch sync to skip drifted project tools, so that local modifications are not overwritten accidentally.
24. As a local AI tool user, I want project-side one-click update for all inconsistent hooks in that project, so that I can refresh a project without visiting every tool row.
25. As a local AI tool user, I want HookHub suite JSON export and import, so that suites can be backed up or moved.
26. As a local AI tool user, I want importing native tool hooks to create a new suite, so that external project hooks can be reused without merging into an existing suite accidentally.
27. As a local AI tool user, I want import name conflicts to offer overwrite, rename, or cancel for HookHub suite JSON, so that recovery and migration both work.
28. As a local AI tool user, I want exported suites to omit project bindings, so that reusable definitions do not carry deployment state.
29. As a local AI tool user, I want HookHub to respect tool-native trust/review models, so that generated config does not pretend to be trusted.
30. As a developer of the manager, I want adapters per tool, so that target-specific hook formats do not leak into shared UI logic.
31. As a developer of the manager, I want tests around suite storage, hooks-section rendering, status detection, replacement protection, import/export, and sync, so that the feature is verified through user-visible behavior.

## Implementation Decisions

- HookHub is app-owned and does not depend on an external hook manager as runtime.
- HookHub is not a hook execution engine; it manages native tool configuration files.
- HookHub manages hook suites, not individual hook components.
- A suite has stable `suiteId` and globally unique editable `name`.
- `suiteId` is the internal binding key; `name` is user-facing and must pass global uniqueness checks.
- A suite can contain multiple tool payloads.
- A suite's payload for a given tool is that tool's complete `hooks` section.
- A project group and tool can bind at most one suite.
- Applying a suite to a project group/tool replaces that tool's entire `hooks` section.
- Applying a suite preserves unrelated settings in the same file.
- Project-side new hook creation creates a HookHub suite and applies it to the current group/tool.
- Project-side edits modify current project hooks first; HookHub updates happen through explicit actions.
- Project-side sharing uploads only the current group/tool hooks section and creates a new suite.
- Uploaded suites start with one tool payload but can later be extended with more tool payloads.
- HookHub supports creating and editing suite payloads from 0.
- HookHub supports explicit center-to-project distribution to selected project groups and tools.
- HookHub batch sync updates only already-enabled bindings for a suite.
- Batch sync covers `outdated` bindings and skips `drifted` bindings.
- Status detection uses binding records plus hooks-section fingerprints, not user-visible version numbers.
- Fingerprints include only the managed tool hooks payload, not suite name, description, risk text, unrelated config, or other tools.
- `missing` can remove binding because no local hooks remain.
- `drifted` cannot remove binding directly; it must be overwritten from HookHub, written back to the bound suite, or saved as a new suite.
- `unmanaged` cannot be directly cleared by HookHub in MVP.
- Replacing unmanaged hooks offers overwrite, upload-then-overwrite, or cancel.
- Replacing drifted suite A with suite B offers overwrite, update suite A then overwrite, save as new suite then overwrite, or cancel.
- Replacing outdated suite A with suite B only needs replacement confirmation; outdated is not a local modification worth saving.
- Before replacement, HookHub uses Git checkpointing when safe and local project backups otherwise.
- Git-managed dirty config files are committed with `chore: HookHub 覆盖前备份 <file>` before overwrite.
- Git-managed clean config files can be overwritten directly.
- Git repo untracked config files are not automatically committed; the UI offers an explicit commit action and still creates a local backup by default.
- Local backups store the whole config file under a project `.hookhub/backups/` path with metadata.
- MVP supports structured hooks-section management for `claude`, `codebuddy`, `codex`, `qwen`, and `qoder`.
- `opencode` and `copilot` are discovery/planning targets only in MVP.
- HookHub suite JSON import can overwrite an existing suite, import as renamed new suite, or cancel on name conflict.
- Native tool hook import always creates a new suite and never imports into an existing suite.
- Suite export excludes project bindings.
- HookHub does not store secret values and does not write system/user environment variables.
- Generated config must not bypass tool-native trust, review, or trusted-folder mechanisms.

## Testing Decisions

- Tests should verify external behavior at storage, API, renderer, discovery, backup, import/export, sync, and UI seams rather than implementation details.
- Storage tests should cover suite uniqueness, multi-tool payloads, one-suite-per-project-group-tool bindings, fingerprints, and cleanup behavior.
- Renderer tests should cover replacing only `hooks` sections for Claude, CodeBuddy, Codex, Qwen, and Qoder while preserving unrelated settings.
- Discovery tests should cover `current`, `outdated`, `drifted`, `missing`, `unmanaged`, and `invalid` states.
- Backup tests should cover Git-managed dirty checkpoint commits, Git-managed clean overwrites, Git repo untracked files, and non-Git local backup files.
- API tests should cover listing HookHub suites, creating/editing suites, listing project hooks, applying suites, replacing existing hooks, sharing current hooks to a new suite, syncing outdated bindings, skipping drifted bindings, import, and export.
- UI tests should cover top-level HookHub navigation, suite create/edit, distribution, project `Hooks` button visibility, project tool status rows, replacement choices, upload-then-overwrite, drift handling, batch sync results, import/export, and risk warnings.
- File write tests should use temporary project directories so no real hook configuration is mutated.
- Similar seams already exist for SkillHub and McpHub: center list APIs, project-side panel APIs, config renderers, local backup/commit flows, and UI tests should be reused where possible.

## Out of Scope

- Running hook scripts from inside this app.
- Validating that an external tool has trusted or accepted a generated hook.
- User-level or system-level hook configuration.
- Managed enterprise/policy hook configuration.
- Secret vault or encrypted secret storage.
- Writing system, user, shell, IDE, or tool-launch environment variables.
- Full diff preview before applying.
- Byte-for-byte JSON/JSONC/TOML formatting preservation.
- Directly clearing unmanaged hooks.
- Merging imported native hooks into an existing suite.
- Applying a suite to projects where it has not been explicitly selected.
- Background sync from HookHub into projects.
- Background sync from projects into HookHub.
- Single-hook component marketplace behavior.
- OpenCode structured plugin authoring in MVP.
- Copilot CLI/cloud hook rendering in MVP.
- Gemini CLI support, because it is not currently part of this repository's `ToolId`.

## Further Notes

HookHub should reuse the existing Hub product pattern only at navigation and ownership level: a top-level center library plus project-context panels. The data model must differ from McpHub because hook behavior is native to each tool and managed as complete suites. The smallest stable unit is a tool hooks section under one project group, not a single hook rule.
