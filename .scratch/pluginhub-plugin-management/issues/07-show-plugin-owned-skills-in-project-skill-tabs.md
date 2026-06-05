Status: ready-for-human

# Show plugin-owned skills in project skill tabs

## Parent

.scratch/pluginhub-plugin-management/PRD.md

## What to build

Extend the project skill management UI to distinguish `SkillHub`, `Local`, and `Plugin` skills. Plugin-owned skills should be visible for explanation but should be managed only from the project `Plugin` entry.

## Acceptance criteria

- [x] Project skill management has `SkillHub`, `Local`, and `Plugin` tabs.
- [x] The `Plugin` tab lists skills installed by complete plugins and groups them by plugin.
- [x] The `SkillHub` tab can show plugin-owned skills when they occupy a SkillHub target path.
- [x] Plugin-owned rows in the `SkillHub` tab are read-only.
- [x] Users cannot cancel a plugin-owned skill from the `SkillHub` tab.
- [x] Users cannot install a different same-name SkillHub skill over a plugin-owned skill from the `SkillHub` tab.
- [x] Plugin-owned skill rows point users back to the project `Plugin` entry for uninstall or sync.
- [x] Tests cover the three tabs, readonly plugin rows, blocked SkillHub overwrite, and navigation back to the Plugin panel.

## Blocked by

- .scratch/pluginhub-plugin-management/issues/06-install-project-plugins-with-ownership-preflight.md

## Implementation notes

2026-06-05: Project skill UI now separates `SkillHub技能`、`本地技能`、`Plugin` tabs and blocks SkillHub overwrite/cancel actions for plugin-owned targets.
