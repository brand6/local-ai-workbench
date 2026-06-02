Status: ready-for-human

# MVP-B add opencode, qwen, qoder, and copilot adapters

## Parent

.scratch/local-ai-project-session-manager/PRD.md

## What to build

Add future tool adapters for opencode, qwen, qoder, and copilot one by one. Each tool may enter the primary project UI only after it supports the same complete capability set as Codex and Claude: new session launch, historical session scan, and resume.

This slice is human-in-the-loop because each tool's local history format and resume behavior must be discovered and verified on the user's machine.

## Acceptance criteria

- [x] Each new tool adapter uses the existing adapter interface rather than special-case project logic.
- [x] For each tool, CLI detection and new-session launch work in a selected cwd.
- [x] For each tool, local session sources are discovered or configurable.
- [x] For each tool, session scanning extracts title, optional summary, session id, cwd, updated time, source file, source format, and parser version.
- [ ] For each tool, resume command construction is reliable and validated with local sessions.
- [x] A tool is hidden from the primary project UI until all three capabilities work for that tool.
- [x] Parser warnings and read-only scanning behavior match Codex/Claude semantics unless a tool-specific reason is documented.
- [ ] At least one tool is completed and manually verified before using this issue as a template for the remaining tools.
- [ ] Any tool whose CLI lacks resume or readable history is documented as blocked rather than partially shipped.

## Implementation notes

- 已将 `ToolId` 扩展为 `codex`、`claude`、`opencode`、`qwen`、`qoder`、`copilot`，所有工具通过统一 `ToolAdapter` 接口提供 CLI detection、new session command、session source discovery、scan metadata 和 resume command construction。
- 默认命令和 resume 参数基于工具官方文档：OpenCode 使用 `opencode --session <id>`，Qwen 使用 `qwen --resume <id>`，Qoder 使用 `qodercli -r <id>`，Copilot 使用 `copilot --resume <id>`。
- 默认 session source 包含 OpenCode `~/.local/share/opencode/project`、Qwen `~/.qwen/projects` 和 `~/.qwen/sessions`、Qoder `~/.qoder/sessions` 和 `~/.qoder/projects`、Copilot `~/.copilot/session-state`；均可通过 config `sessionSources` 覆盖。
- 前端工具 picker 改为读取 adapter capability/status，不再硬编码 Codex/Claude。当前所有新增工具都声明完整 capability，因此进入主项目页；若后续某工具实测不可用，应将 capability 降级并保持隐藏。
- 自动化测试覆盖 adapter command construction、项目可见工具列表、MVP-B parser cwd/session id 字段和只读扫描语义。真实 CLI 启动、真实历史扫描和真实 resume 仍需人工验收。

## Blocked by

- .scratch/local-ai-project-session-manager/issues/13-validate-mvp-a-end-to-end-on-local-machine.md
