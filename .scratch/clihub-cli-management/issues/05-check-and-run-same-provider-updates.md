Status: ready-for-human

# Check and run same-provider updates

## Parent

.scratch/clihub-cli-management/PRD.md

## What to build

Add explicit update checks and same-provider updates. CliHub should not check for updates automatically. The user can check one CLI or all visible CLIs, see a three-state result, and run an update only when the CLI has a clear current provider and update command.

## Acceptance criteria

- [ ] CliHub exposes explicit update check actions.
- [ ] Update checks never run automatically in the background.
- [ ] Update check results are stored as `up-to-date`, `update-available`, or `unknown`.
- [ ] Failed checks do not affect CLI availability.
- [ ] Same-provider update is available only when the current CLI record has a clear provider/package or configured update command.
- [ ] `npm` CLIs update only through npm.
- [ ] `winget` CLIs update only through winget.
- [ ] `choco` CLIs update only through choco.
- [ ] `scoop` CLIs update only through scoop.
- [ ] `installer-command` CLIs update only when an explicit update command is configured.
- [ ] Local-path and unknown-provider CLIs do not show update.
- [ ] Update completion refreshes discovery.
- [ ] Tests cover update check states, failed update checks, unavailable update actions for unknown sources, and same-provider update execution.

## Blocked by

- 02-refresh-cli-discovery-and-availability.md
- 03-model-install-channels-and-provider-parsing.md
