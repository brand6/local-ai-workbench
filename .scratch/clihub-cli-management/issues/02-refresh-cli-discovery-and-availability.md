Status: ready-for-human

# Refresh CLI discovery and availability

## Parent

.scratch/clihub-cli-management/PRD.md

## What to build

Add CLI discovery so CliHub can refresh local command availability, resolved paths, versions, and provider confidence. Discovery should support explicit refresh, app startup/data-dir initialization, opening CliHub, and a stale-result refresh path for views that need current availability.

Project preferences should not be deleted or rewritten when a CLI becomes unavailable.

## Acceptance criteria

- [ ] CliHub can refresh discovery for built-in CLI entries.
- [ ] Discovery records available/unavailable state and resolved executable paths.
- [ ] Version command success records a version.
- [ ] Version command failure records unknown version with an error summary but keeps the CLI usable when the command exists.
- [ ] PATH-discovered CLIs with unknown provider are marked usable but not updatable.
- [ ] High-confidence provider inference can record known provider/package data.
- [ ] Low-confidence provider inference is exposed as a candidate that requires user confirmation before update is enabled.
- [ ] Project tool preferences remain unchanged when discovery marks an agent-tool CLI unavailable.
- [ ] Tests cover discovery success, missing command, version failure, unknown provider, and provider candidate states.

## Blocked by

- 01-build-clihub-center-inventory.md
