Status: ready-for-human

# Install project plugins with ownership preflight

## Parent

.scratch/pluginhub-plugin-management/PRD.md

## What to build

Add a project `Plugin` entry that installs a complete source plugin or custom plugin into a project. Installation creates a plugin binding, resolves target components, runs ownership preflight, and records which components are managed by the plugin versus using existing project files.

## Acceptance criteria

- [x] Project detail has a `Plugin` entry or panel for complete plugin installation.
- [x] Users can select an installable source plugin or custom plugin from PluginHub.
- [x] Installing into an empty target creates a project plugin binding and managed component owner records.
- [x] If the same component already exists at the target path, installation adds the plugin as an additional owner without prompting.
- [x] If a different component or local file occupies the target path, installation asks whether to overwrite.
- [x] Choosing overwrite transfers ownership of that target path to the new component and plugin.
- [x] Choosing not to overwrite keeps the previous owner or local file and still allows the plugin binding to be created.
- [x] Required custom plugin components block installation when the user declines overwrite.
- [x] Optional custom plugin components can be skipped when the user declines overwrite.
- [x] The install result includes managed versus existing component counts.
- [x] Tests cover empty install, shared component owner, overwrite, skip, local overwrite preflight integration, and partial install success.

## Blocked by

- .scratch/pluginhub-plugin-management/issues/03-index-plugin-components-into-component-hubs.md
- .scratch/pluginhub-plugin-management/issues/05-unified-local-file-overwrite-backups.md

## Implementation notes

2026-06-05: Project detail now has a `Plugin` side panel with install/sync/uninstall actions and PluginHub ownership records.
