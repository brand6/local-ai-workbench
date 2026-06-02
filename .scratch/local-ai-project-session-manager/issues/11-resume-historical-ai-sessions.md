Status: ready-for-agent

# Resume historical AI sessions

## Parent

.scratch/local-ai-project-session-manager/PRD.md

## What to build

Implement resume behavior from session cards. Resume should be enabled only when the session has a reliable tool-native session id, the CLI is available, and the historical cwd exists. Launch should open a new terminal window in the historical session cwd and execute the tool adapter's resume command.

This slice should let the user resume indexed Codex and Claude sessions from the project detail page.

## Acceptance criteria

- [x] Codex session cards expose resume when session id, CLI, and cwd are valid.
- [x] Claude session cards expose resume when session id, CLI, and cwd are valid.
- [x] Resume is disabled with a clear reason when session id, CLI, or cwd is unavailable.
- [x] Resume uses the session's historical cwd as working directory.
- [x] Codex resume command uses the tool-native session id.
- [x] Claude resume command uses the tool-native session id.
- [x] Windows launch behavior matches the new-session terminal launcher rules.
- [x] Tests verify resume eligibility, disabled reasons, cwd validation, and command construction without launching real terminals.

## Blocked by

- .scratch/local-ai-project-session-manager/issues/03-implement-codex-claude-tool-adapters.md
- .scratch/local-ai-project-session-manager/issues/04-scan-codex-claude-sessions-into-readonly-index.md
- .scratch/local-ai-project-session-manager/issues/09-build-project-detail-session-grouping.md
- .scratch/local-ai-project-session-manager/issues/10-launch-new-ai-sessions.md

## Comments

- 2026-06-01：已实现 session card 恢复按钮、resume eligibility、历史 cwd 使用和 Codex/Claude resume argv 构造。验证覆盖 disabled reason 与命令构造。
