Status: ready-for-human

# Delete sources and plugin indexes with impact preview

## Parent

.scratch/pluginhub-plugin-management/PRD.md

## What to build

Add deletion previews for sources, source plugins, and custom plugins. Source deletion is high impact because it owns imported source components and source plugins. Plugin deletion removes only the combination index and private material, not source-owned components that may still be used elsewhere.

## Acceptance criteria

- [x] Deleting a source shows affected source plugins, source components, custom plugins that reference those components, and project plugin bindings.
- [x] If custom plugins reference source components, the user must choose to delete those custom plugins or remove the referenced components from them.
- [x] Confirmed source deletion removes source plugins and source-owned component records through the relevant component Hubs.
- [x] Confirmed source deletion does not leave custom plugins with dangling component references.
- [x] Deleting a source plugin removes the plugin index and source plugin private material.
- [x] Deleting a source plugin does not delete source-owned components while the source remains.
- [x] Deleting a custom plugin removes the custom plugin and its private files, but not referenced source components.
- [x] If project-side cleanup fails, center records are preserved and the failure is reported.
- [x] Tests cover source deletion choices, source plugin deletion, custom plugin deletion, project binding impact, component cleanup, and partial cleanup failure preservation.

## Blocked by

- .scratch/pluginhub-plugin-management/issues/04-create-and-edit-custom-plugins.md
- .scratch/pluginhub-plugin-management/issues/09-sync-and-uninstall-project-plugin-bindings.md

## Implementation notes

2026-06-05: Source/plugin delete previews are implemented. Source delete cleans project skill targets before removing source-owned SkillHub records and reports cleanup failures without deleting center records.
