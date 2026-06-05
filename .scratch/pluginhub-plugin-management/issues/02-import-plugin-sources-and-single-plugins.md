Status: ready-for-human

# Import plugin libraries and single plugin packages

## Parent

.scratch/pluginhub-plugin-management/PRD.md

## What to build

Implement `添加 Plugin` so users can import an external plugin library/source or a single plugin package into PluginHub. A plugin library is imported as one source with all discovered plugins. A single plugin package is automatically wrapped in a same-name source so PluginHub never has a bare-plugin special case.

## Acceptance criteria

- [x] `添加 Plugin` accepts a local source path representing a plugin library.
- [x] Importing a plugin library creates one source and imports all discovered source plugins by default.
- [x] `添加 Plugin` accepts a local path representing one plugin package.
- [x] Importing one plugin creates a same-name source containing exactly that plugin.
- [x] Imported source plugins appear in the `Plugins` list.
- [x] Imported sources appear in the `Sources` list with enough metadata to refresh or delete later.
- [x] The importer records plugin-private source files as private material, not as component Hub records.
- [x] Tests cover multi-plugin source import, single-plugin wrapping, duplicate import behavior, invalid package reporting, and plugin-private discovery.

## Blocked by

- .scratch/pluginhub-plugin-management/issues/01-build-pluginhub-shell-and-model.md

## Implementation notes

2026-06-05: `添加 Plugin` 支持 library 和 single-plugin 目录；重复导入使用稳定 source/plugin id；无效目录会报告未找到可导入 plugin。
