Status: ready-for-agent

# Add and remove managed projects

## Parent

.scratch/local-ai-project-session-manager/PRD.md

## What to build

Implement manual project management for confirmed top-level projects. Users can add a local project directory, store it in the manager, configure include-subdirectories, and remove the project from the manager without deleting files or AI sessions.

This slice should make a manually added project appear in the homepage and persist after restart.

## Acceptance criteria

- [x] Users can add a project directory through the UI and API.
- [x] Added projects are stored as confirmed projects, not scan candidates.
- [x] Project paths are normalized for matching while preserving display paths.
- [x] Each project has an include-subdirectories setting.
- [x] Users can remove a project from the manager.
- [x] Removing a project only removes the manager project record and does not delete project files or AI session files.
- [x] Restarting the app reloads added projects.
- [x] Tests cover add, duplicate add, normalized path handling, include-subdirectories persistence, and remove.

## Blocked by

- .scratch/local-ai-project-session-manager/issues/02-build-sqlite-index-and-core-models.md

## Comments

- 2026-06-01：已实现 UI/API 手动添加、移除、路径规范化、include-subdirectories 持久化和重启重载。验证覆盖 add/reload/remove 相关路径规则。
