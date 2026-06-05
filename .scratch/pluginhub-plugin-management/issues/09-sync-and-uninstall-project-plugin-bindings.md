Status: ready-for-human

# Sync and uninstall project plugin bindings

## Parent

.scratch/pluginhub-plugin-management/PRD.md

## What to build

Support project-side plugin topology sync and uninstall. Content-only changes should flow through existing component links or materialization behavior. Topology changes such as added or removed components, changed private files, or changed custom plugin composition require explicit project sync.

## Acceptance criteria

- [x] Project Plugin panel can show that a plugin has topology changes requiring sync.
- [x] Sync recomputes current plugin components and private files.
- [x] Sync adds new ordinary components when targets are empty or already contain the same component.
- [x] Sync asks overwrite questions for new ordinary components that conflict with different existing components.
- [x] Sync blocks on private-file conflicts with different private identities.
- [x] Sync removes the plugin owner from components removed from the plugin.
- [x] Removed components are deleted from the project only when no owners remain.
- [x] Uninstall releases the plugin's component owners and private-file owners.
- [x] Uninstall does not restore overwritten SkillHub or local versions.
- [x] Tests cover topology add, topology remove, shared owner retention, last owner deletion, private conflict blocking, and uninstall cleanup.

## Blocked by

- .scratch/pluginhub-plugin-management/issues/08-install-plugin-private-files-and-native-packages.md

## Implementation notes

2026-06-05: Project plugin bindings store topology hashes; project panel surfaces sync-required bindings and sync/uninstall release ownership with shared-owner retention.
