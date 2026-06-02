Status: ready-for-human

# MVP-B project relocation and cwd writeback

## Parent

.scratch/local-ai-project-session-manager/PRD.md

## What to build

Add the MVP-B project relocation workflow for projects that were moved outside the manager. The user chooses an old root and a new root, previews affected sessions and source files, confirms the operation, receives backups, and the manager writes only tool-format session-level cwd fields before rebuilding the index.

This slice is human-in-the-loop because it modifies Codex/Claude original session files and must be verified carefully with local data.

## Acceptance criteria

- [x] The user can start a relocation workflow with explicit oldRoot and newRoot paths.
- [x] The app previews affected sessions, source files, and cwd changes before writing.
- [x] The workflow requires explicit confirmation before modifying any original session file.
- [x] Original session files are backed up before writeback.
- [x] Writeback modifies only fields that represent session-level working directory.
- [x] Writeback does not modify user messages, assistant messages, tool inputs, tool outputs, or arbitrary string occurrences.
- [x] The index is rebuilt after successful writeback.
- [x] Relocated sessions display under the new project path after rebuild.
- [ ] Resume behavior is manually verified for at least one relocated Codex or Claude session.
- [x] Failure and rollback behavior is documented.

## Implementation notes

- 已实现 `/api/relocations/preview` 和 `/api/relocations/confirm`，前端项目详情页提供当前项目根目录、新根目录、预览和 `RELOCATE` 确认写回入口。
- 写回前会在 `dataDir/backups/relocations/<timestamp>/` 备份受影响源文件；确认后只重写 session-level cwd 字段，例如 `cwd`、`projectRoot`、`workspaceRoot` 和已知 session metadata cwd 路径。
- 写回不会替换 user/assistant 消息文本、tool input、tool output 或任意字符串。自动化测试覆盖了消息和 `tool_input.cwd` 中的旧路径保持不变。
- 写回成功后会更新受影响 managed project root，并对本次受影响的源文件执行 scoped session index rebuild，使 relocated session 显示在新项目路径下，避免真实历史很多时确认写回长时间无反馈。
- 如果写回、project root 更新或重建索引过程中抛错，已备份的源文件会恢复，project root 更新也会反向恢复。人工验收仍需使用真实 Codex 或 Claude 会话验证 resume。

## Blocked by

- .scratch/local-ai-project-session-manager/issues/13-validate-mvp-a-end-to-end-on-local-machine.md
