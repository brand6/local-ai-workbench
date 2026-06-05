Status: ready-for-human

# Create and edit custom plugins in PluginHub

## Parent

.scratch/pluginhub-plugin-management/PRD.md

## What to build

Add `创建 Plugin` for user-created custom plugins. A custom plugin is a PluginHub-owned combination with no source. It can reference components from different sources and can contain PluginHub-managed private files. Components can be marked required or optional so install and sync can distinguish mandatory plugin pieces from skippable convenience pieces.

## Acceptance criteria

- [x] Users can create a custom plugin from PluginHub.
- [x] Custom plugin records have no source and appear in the installable `Plugins` list.
- [x] Users can add component references from available component Hubs to a custom plugin.
- [x] Referenced components keep their original source identity.
- [x] Users can mark custom plugin components as required or optional.
- [x] Users can create or import custom plugin private files from PluginHub.
- [x] Component Hubs do not expose plugin-private file creation or editing.
- [x] Tests cover custom plugin creation, cross-source component references, required and optional flags, private-file editing, and installable plugin list inclusion.

## Blocked by

- .scratch/pluginhub-plugin-management/issues/01-build-pluginhub-shell-and-model.md
- .scratch/pluginhub-plugin-management/issues/03-index-plugin-components-into-component-hubs.md

## Implementation notes

2026-06-05: `创建 Plugin` 和 custom plugin edit 已接入 UI/API；edit 在未提供新 private-file 内容时保留原 private material。
