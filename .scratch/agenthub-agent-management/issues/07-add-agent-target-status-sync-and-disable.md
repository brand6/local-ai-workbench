Status: ready-for-agent

# Add Agent target status, sync, disable, and backup

## Parent

.scratch/agenthub-agent-management/PRD.md

## What to build

Add full managed target lifecycle behavior. Project Agent targets should report `current`, `outdated`, `drifted`, `missing`, `unmanaged`, and `invalid`; support syncing outdated targets from AgentHub; skip drifted targets in batch sync; and disable managed targets safely.

Overwrites and destructive drifted disables must use the project's common backup logic rather than an AgentHub-only backup path.

## Acceptance criteria

- [ ] Project Agent state reports `current` when the project file matches the last AgentHub generated output and the center truth has not changed.
- [ ] Project Agent state reports `outdated` when the project file is unchanged but center truth or rendered output changed.
- [ ] Project Agent state reports `drifted` when the project file differs from the last AgentHub generated output.
- [ ] Project Agent state reports `missing` when a binding exists but the project output file is gone.
- [ ] Project Agent state reports `unmanaged` for recognized files without bindings and `invalid` for parse/render failures.
- [ ] Single-target sync rewrites outdated targets and updates binding hashes.
- [ ] Batch sync processes only outdated targets and lists skipped drifted/missing/invalid targets with internal reasons.
- [ ] Disabling current/outdated targets deletes the managed project file and removes the binding.
- [ ] Disabling missing targets removes only the binding.
- [ ] Disabling drifted targets requires confirmation and supports keeping the file while removing binding.
- [ ] Destructive overwrite/delete flows call the shared project backup logic used by existing hubs or an extracted common helper.
- [ ] Tests cover all statuses, single sync, batch sync skipping, disable current/outdated/missing/drifted, backup invocation, and UI status/actions.

## Blocked by

- .scratch/agenthub-agent-management/issues/05-build-project-agent-panel-and-target-writes.md
- .scratch/agenthub-agent-management/issues/06-discover-and-migrate-local-project-agents.md

