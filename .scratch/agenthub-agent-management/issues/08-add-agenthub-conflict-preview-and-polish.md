Status: ready-for-agent

# Add AgentHub conflict preview and polish

## Parent

.scratch/agenthub-agent-management/PRD.md

## What to build

Complete the AgentHub MVP interaction details around safe replacement and user-visible previews. Enabling, syncing, overwriting unmanaged files, replacing another managed target, and converting across tools should show enough preview information for the user to understand the target path and action before a file is written.

This slice should also align AgentHub UI details with the existing SkillHub compact row and project panel patterns.

## Acceptance criteria

- [ ] Enabling a target returns a preview with target tool, target path, action kind, source truth, truth role, and rendered summary.
- [ ] Syncing an outdated target returns the same preview before writing.
- [ ] Applying an AgentHub agent over an unmanaged file requires confirmation and offers overwrite, migrate-then-overwrite, or cancel.
- [ ] Applying an AgentHub agent over another managed target at the same path requires replacement confirmation and removes or updates the previous binding consistently.
- [ ] Project UI uses compact row actions, source grouping, search, and bottom-right toast behavior consistent with SkillHub.
- [ ] Center and project rows show lightweight truth tool and truth role tags.
- [ ] Unavailable or unsupported tools are hidden from project target checkboxes instead of showing explanatory disabled chips.
- [ ] Opening center native file/folder and project output file/folder works from the relevant row actions.
- [ ] Tests cover preview payloads, unmanaged overwrite confirmation, migrate-then-overwrite, managed replacement, hidden unsupported tools, row actions, toast refresh, and open file/folder actions.

## Blocked by

- .scratch/agenthub-agent-management/issues/04-import-local-agent-folders.md
- .scratch/agenthub-agent-management/issues/05-build-project-agent-panel-and-target-writes.md
- .scratch/agenthub-agent-management/issues/06-discover-and-migrate-local-project-agents.md
- .scratch/agenthub-agent-management/issues/07-add-agent-target-status-sync-and-disable.md

