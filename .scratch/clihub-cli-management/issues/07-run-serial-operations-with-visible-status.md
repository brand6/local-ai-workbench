Status: ready-for-human

# Run serial operations with visible status

## Parent

.scratch/clihub-cli-management/PRD.md

## What to build

Add the CliHub operation runner and UI status behavior. Install, update check, and update operations should run serially. The app should show a visible status while an operation runs, even if the user leaves the CliHub page, and each CLI should retain its most recent operation result.

## Acceptance criteria

- [ ] CliHub runs install, update check, and update operations through a global serial runner.
- [ ] A second CliHub operation cannot start while another is running.
- [ ] Running operations display a visible app-level or page-level status message.
- [ ] The status remains visible when the user leaves CliHub.
- [ ] Each CLI stores its most recent operation result.
- [ ] Failed operation results include exit code and bounded stdout/stderr summaries.
- [ ] Successful operation results include provider and completion time.
- [ ] The app does not maintain long-term operation history in MVP.
- [ ] App close can interrupt an in-flight operation without recovery logic.
- [ ] Tests cover serial operation blocking, running status display, success result, failure result, and bounded output capture.

## Blocked by

- 04-install-cli-and-manage-path.md
- 05-check-and-run-same-provider-updates.md
