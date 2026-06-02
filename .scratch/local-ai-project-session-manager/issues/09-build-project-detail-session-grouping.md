Status: ready-for-agent

# Build project detail session grouping

## Parent

.scratch/local-ai-project-session-manager/PRD.md

## What to build

Build the project detail view that groups indexed sessions by root or subproject cwd, then by tool, then by session. The view should display friendly labels, full path details, sorting rules, session cards, optional summaries, and expandable lightweight metadata.

This slice should let the user open a project and understand its Codex/Claude history without launching any CLI.

## Acceptance criteria

- [x] Project detail groups sessions into root and subproject groups according to include-subdirectories.
- [x] The root group is fixed at the top and uses the project directory name with root-directory labeling.
- [x] Child groups use relative path labels and show full path details.
- [x] Child groups sort by newest session activity.
- [x] Tool groups sort by session count, then latest session time.
- [x] Sessions sort by updated time descending.
- [x] Session cards show title, last updated time, and summary only when a summary exists.
- [x] Expanding a session card shows tool, session id, cwd, source file, and resume status metadata.
- [x] Title/summary filtering is available without full-text transcript search.
- [x] Tests cover grouping, sorting, summary omission, metadata expansion, and filter behavior.

## Blocked by

- .scratch/local-ai-project-session-manager/issues/04-scan-codex-claude-sessions-into-readonly-index.md
- .scratch/local-ai-project-session-manager/issues/07-apply-parent-child-project-grouping-rules.md
- .scratch/local-ai-project-session-manager/issues/08-build-project-list-and-chinese-homepage.md

## Comments

- 2026-06-01：已实现项目详情 root/subproject -> tool -> session 分组、排序、可选摘要、metadata 展开和标题/摘要筛选。验证覆盖分组、排序和筛选。
