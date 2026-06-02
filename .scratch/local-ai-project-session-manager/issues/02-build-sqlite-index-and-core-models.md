Status: ready-for-agent

# Build SQLite index and core models

## Parent

.scratch/local-ai-project-session-manager/PRD.md

## What to build

Add the persistent SQLite-backed index and core application models needed by the manager. The app should store confirmed projects, session index entries, scan sources, scan runs, scan candidates, parser warnings, tool metadata, and parser format/version metadata.

This slice should make the app able to persist and reload empty or seeded project/session state through the same API shapes the UI will use later.

## Acceptance criteria

- [x] SQLite is initialized inside the selected manager data directory.
- [x] The schema supports confirmed projects, session index entries, scan sources, scan runs, scan candidates, parser warnings, and settings metadata.
- [x] Session index entries include tool id, tool-native session id, title, optional summary, original cwd, normalized cwd, updated time, source file, source format, parser version, and resume status fields.
- [x] Projects include root path, normalized root path, include-subdirectories state, and timestamps.
- [x] The app can read/write config JSON with a backup copy.
- [x] Startup opens an existing index and exposes cached project/session data without requiring a rescan.
- [x] Unit tests cover schema initialization, persistence, reload, and basic model validation.

## Blocked by

- .scratch/local-ai-project-session-manager/issues/01-initialize-local-app-shell-and-data-dir.md

## Comments

- 2026-06-01：已实现 node:sqlite 索引、核心表结构、config.json 及备份、项目/会话持久化与重载。验证覆盖 schema 初始化、持久化和重载。
