Status: ready-for-agent

# Implement Codex and Claude tool adapters

## Parent

.scratch/local-ai-project-session-manager/PRD.md

## What to build

Introduce the tool adapter boundary and implement Codex and Claude adapters for MVP-A. Each adapter detects CLI availability, exposes default session source locations, builds new-session launch commands, and builds resume launch commands from indexed sessions.

This slice should not scan sessions yet. It should make tool status and launch command construction testable through backend APIs.

## Acceptance criteria

- [x] A shared tool adapter interface exists for CLI detection, session source discovery, new-session command construction, and resume command construction.
- [x] Codex adapter detects the configured Codex command and default Codex session source directories.
- [x] Claude adapter detects the configured Claude command and default Claude session source directories.
- [x] Codex new-session command runs Codex in the requested cwd.
- [x] Claude new-session command runs Claude in the requested cwd.
- [x] Codex resume command uses the tool-native session id with the configured Codex command.
- [x] Claude resume command uses the tool-native session id with the configured Claude command.
- [x] Tool command paths are configurable through app settings.
- [x] Tests verify command construction without starting real CLIs.

## Blocked by

- .scratch/local-ai-project-session-manager/issues/02-build-sqlite-index-and-core-models.md

## Comments

- 2026-06-01：已实现 Codex/Claude adapter 边界、CLI 检测、默认 source、new/resume argv 构造和工具配置读取。验证覆盖命令构造且不启动真实 CLI。
