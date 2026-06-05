Status: ready-for-human

# Build PluginHub shell and plugin catalog model

## Parent

.scratch/pluginhub-plugin-management/PRD.md

## What to build

Add the first demoable PluginHub path: a top-level `PluginHub` entry opens an independent page, the backend can persist and list empty PluginHub sources, source plugins, custom plugins, and project plugin bindings, and the UI clearly separates `Sources`, `Plugins`, and `Custom Plugins`.

This slice establishes vocabulary and storage without importing external content yet.

## Acceptance criteria

- [x] The top bar has a `PluginHub` entry that opens a PluginHub page.
- [x] PluginHub has visible sections or tabs for `Sources`, `Plugins`, and `Custom Plugins`.
- [x] The backend can persist and list empty PluginHub catalog data through the existing local API protection model.
- [x] The model distinguishes `source`, `source plugin`, and `custom plugin`.
- [x] `custom plugin` records have no source.
- [x] Plugin records can store component references and private-file metadata without storing component content.
- [x] Project plugin binding records can store ownership details separately from plugin catalog records.
- [x] Tests cover empty catalog initialization, list APIs, UI navigation, and the source plugin versus custom plugin distinction.

## Blocked by

None - can start immediately

## Implementation notes

2026-06-05: 已实现 PluginHub catalog 存储、API、顶层页面和项目 binding 模型。验证见 `tests/pluginhub.test.ts` 与 `tests/ui.test.tsx`。
