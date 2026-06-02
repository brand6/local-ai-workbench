Status: ready-for-agent

# Build project list and Chinese homepage

## Parent

.scratch/local-ai-project-session-manager/PRD.md

## What to build

Build the Chinese homepage around confirmed top-level projects. The page should show cached projects immediately on app launch, expose add/scan actions, show child-count markers for projects with actual child session groups, and clearly distinguish empty state from indexed state.

This slice should make the app useful as a project entry point before project details are fully implemented.

## Acceptance criteria

- [x] Homepage UI is in Chinese.
- [x] On second launch, cached confirmed projects appear without manual refresh.
- [x] The project list shows only top-level projects.
- [x] Projects with actual child session groups show a child-count marker.
- [x] Empty state offers manual add and scan actions.
- [x] Project cards show relevant path/status information without implying scan candidates are confirmed projects.
- [x] Removing a project updates the homepage without deleting project files or AI sessions.
- [x] UI tests cover empty state, cached project display, child-count marker, and project removal.

## Blocked by

- .scratch/local-ai-project-session-manager/issues/05-add-and-remove-managed-projects.md
- .scratch/local-ai-project-session-manager/issues/07-apply-parent-child-project-grouping-rules.md

## Comments

- 2026-06-01：已实现中文首页、缓存项目列表、空状态、添加/扫描入口、child-count marker 和安全移除项目。UI 测试覆盖空状态与 child-count marker。
