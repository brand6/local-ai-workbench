Status: ready-for-agent

# Launch new AI sessions

## Parent

.scratch/local-ai-project-session-manager/PRD.md

## What to build

Implement the new-session flow from project root and subproject groups. Each group shows one new-session button, opens a Codex/Claude tool picker, validates the target cwd and CLI status, and opens a new terminal window to start the selected CLI.

This slice should let the user start a new Codex or Claude session in the correct project or subproject directory.

## Acceptance criteria

- [x] Each root/subproject group exposes one new-session button.
- [x] Clicking the button opens a Chinese tool picker for Codex and Claude.
- [x] Tools with unavailable CLI status are disabled with a clear reason.
- [x] Launch validates that the selected cwd exists.
- [x] Codex launches in the selected cwd.
- [x] Claude launches in the selected cwd.
- [x] Windows launch prefers Windows Terminal and falls back to PowerShell.
- [x] Default behavior opens a new terminal window.
- [x] Launch command construction avoids unsafe shell string interpolation.
- [x] Tests verify API validation and command construction without opening real terminals.

## Blocked by

- .scratch/local-ai-project-session-manager/issues/03-implement-codex-claude-tool-adapters.md
- .scratch/local-ai-project-session-manager/issues/09-build-project-detail-session-grouping.md

## Comments

- 2026-06-01：已实现 group 级新会话按钮、Codex/Claude picker、CLI/cwd 校验、Windows Terminal 优先和 PowerShell fallback。验证覆盖 dry-run command/host 构造。
