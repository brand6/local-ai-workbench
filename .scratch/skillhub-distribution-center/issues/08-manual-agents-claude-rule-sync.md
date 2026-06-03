Status: ready-for-human

# Manual AGENTS.md and CLAUDE.md rule sync

## Parent

.scratch/skillhub-distribution-center/PRD.md

## What to build

Add project-level manual rule sync for `AGENTS.md` and `CLAUDE.md`. The project detail toolbar gets a “规则同步” button that opens a modal, shows file status, lets users choose one direction, and applies the defined Git protection flow before overwriting target content.

## Acceptance criteria

- [ ] Project detail has a “规则同步” button in the same top action area as “刷新项目” and “技能”.
- [ ] The rule sync UI is a modal, not a side panel.
- [ ] The modal only covers `AGENTS.md` and `CLAUDE.md`.
- [ ] The modal shows each file's existence, last modified time, Git management state, and whether that file has uncommitted changes when Git data is available.
- [ ] `AGENTS.md -> CLAUDE.md` is disabled when `AGENTS.md` does not exist.
- [ ] `CLAUDE.md -> AGENTS.md` is disabled when `CLAUDE.md` does not exist.
- [ ] When both files do not exist, both directions are disabled and no create-rule action is shown.
- [ ] If the target file does not exist, sync writes it directly.
- [ ] If the target file exists with identical content, sync is a no-op.
- [ ] If the target file is Git-managed and has uncommitted content, sync silently stages and commits only that target rule file with `chore: 同步规则前备份 <file>`, then overwrites it.
- [ ] If the target file is Git-managed and has no uncommitted content, sync silently overwrites it.
- [ ] If the project is not Git-managed but `git` is available, sync asks whether to initialize Git and commit the rule file before overwrite.
- [ ] If `git` is unavailable, sync asks whether to overwrite without a Git protection point.
- [ ] No rule sync path commits unrelated files.
- [ ] Tests cover disabled directions, missing target write, same-content no-op, Git-managed dirty target checkpoint, Git-managed clean overwrite, non-Git init prompt path, git-unavailable overwrite prompt path, and no unrelated staging.

## Blocked by

None - can start immediately
