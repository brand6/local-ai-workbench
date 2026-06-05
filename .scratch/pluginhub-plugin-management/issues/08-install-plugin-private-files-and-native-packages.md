Status: ready-for-human

# Install plugin-private files and native plugin packages

## Parent

.scratch/pluginhub-plugin-management/PRD.md

## What to build

Add PluginHub-owned handling for plugin-private files and target-tool-native plugin package generation. Private files are installed only as part of complete plugin installation and are never exposed as standalone component Hub items.

## Acceptance criteria

- [x] Source plugin private files are stored as PluginHub private material.
- [x] Custom plugin private files can be packaged with custom plugins.
- [x] Complete plugin install can materialize or link private files into the target tool's native plugin layout.
- [x] Private files do not appear in SkillHub, AgentHub, McpHub, or HookHub lists.
- [x] Private-file target conflicts with a different private identity block install or sync.
- [x] Private-file overwrite of unmanaged/local files uses the unified local backup preflight.
- [x] Uninstall removes private files owned only by that plugin.
- [x] Tests cover private-file install, blocked conflict, local backup integration, uninstall cleanup, and absence from component Hub lists.

## Blocked by

- .scratch/pluginhub-plugin-management/issues/06-install-project-plugins-with-ownership-preflight.md
- .scratch/pluginhub-plugin-management/issues/11-research-wshobson-harness-adapters.md

## Implementation notes

2026-06-05: Implemented Codex-oriented private file materialization under PluginHub ownership. Non-Codex harness-native package generation remains guided by `.scratch/pluginhub-plugin-management/wshobson-harness-research.md`.
