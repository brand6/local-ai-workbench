Status: ready-for-agent

# Apply parent-child project grouping rules

## Parent

.scratch/local-ai-project-session-manager/PRD.md

## What to build

Implement the path relationship rules that keep the main project list top-level while representing child work inside parent project details. Parent/child relationships should automatically enable include-subdirectories and avoid duplicate top-level entries.

This slice should make manual add and scan-confirm flows behave consistently for nested projects.

## Acceptance criteria

- [x] If a child project was already added and the user later adds its parent, the child is removed from the top-level project list.
- [x] If a parent project exists and the user adds a child directory, no new top-level project is created.
- [x] Whenever added projects form a parent-child path relationship, the parent include-subdirectories setting is enabled automatically.
- [x] Batch candidate add keeps the parent as the top-level project when parent and child candidates are both selected.
- [x] If no parent candidate exists, child candidates can be added as their own top-level projects.
- [x] Users can later turn include-subdirectories off manually without deleting indexed sessions.
- [x] Tests cover child-first add, parent-first add, batch add, path-boundary safety, and manual include-subdirectories changes.

## Blocked by

- .scratch/local-ai-project-session-manager/issues/05-add-and-remove-managed-projects.md
- .scratch/local-ai-project-session-manager/issues/06-scan-project-candidates-and-confirm-additions.md

## Comments

- 2026-06-01：已实现父子路径合并规则：child-first、parent-first、batch confirm、自动启用 include-subdirectories 和手动关闭。验证覆盖父子合并与 path boundary。
