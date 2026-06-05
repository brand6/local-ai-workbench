Status: ready-for-human

# Add unified local file overwrite backup preflight

## Parent

.scratch/pluginhub-plugin-management/PRD.md

## What to build

Introduce a shared project write preflight for any Hub operation that would overwrite unmanaged/local project files. The behavior is not PluginHub-specific: SkillHub, AgentHub, McpHub, HookHub, and PluginHub should use the same rules and backup location when they need to replace local project files.

## Acceptance criteria

- [x] A shared preflight can report target path, target resource type, existing owner type, overwrite reason, and whether backup is required.
- [x] Unmanaged/local file overwrite requires explicit confirmation before writing.
- [x] Confirmed local overwrite creates a project-local backup before writing.
- [x] Backup metadata records the original path, triggering Hub, target resource type, and timestamp.
- [x] Managed binding takeover can opt out of local backup when the overwritten content remains recoverable from its Hub source.
- [x] PluginHub project install uses this shared preflight for local skill and private-file overwrite cases.
- [ ] Tests cover unmanaged file backup, managed takeover without backup, backup metadata, and shared use from at least one existing Hub plus PluginHub.

## Blocked by

None - can start immediately

## Implementation notes

2026-06-05: PluginHub install/sync now uses the preflight/backup shape for skill and private-file overwrites. The remaining unchecked item is broader adoption by an existing non-PluginHub write path; SkillHub currently refuses non-link local-folder overwrites rather than backing them up.
