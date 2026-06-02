Status: ready-for-agent

# Refresh index and surface parser warnings

## Parent

.scratch/local-ai-project-session-manager/PRD.md

## What to build

Add refresh and warning visibility for the project/session index. The app should show cached data immediately, allow manual refresh, perform lightweight refresh when opening a project page, and surface scan/index quality through counts and warning details.

This slice should let users trust and update the displayed session history without requiring full-disk rescans.

## Acceptance criteria

- [x] App startup shows cached projects and sessions before any refresh.
- [x] Project detail can trigger a lightweight refresh for relevant session sources.
- [x] Users can manually refresh the current project sessions.
- [x] Users can manually trigger a broader session index refresh.
- [x] Refresh results show indexed count, skipped count, and warning count.
- [x] Parser warnings are visible from the UI with tool, source file, and error type.
- [x] Refresh does not modify Codex or Claude original session files.
- [x] Tests cover cached display, refresh triggering, warning persistence, warning display, and read-only behavior.

## Blocked by

- .scratch/local-ai-project-session-manager/issues/04-scan-codex-claude-sessions-into-readonly-index.md
- .scratch/local-ai-project-session-manager/issues/09-build-project-detail-session-grouping.md

## Comments

- 2026-06-01：已实现启动缓存显示、项目/全局刷新 API、刷新计数、parser warning 持久化和 UI 展示。验证覆盖刷新、warning 记录与只读扫描路径。
