Status: ready-for-human

# Install CLI and manage PATH

## Parent

.scratch/clihub-cli-management/PRD.md

## What to build

Implement CLI installation from approved install channels. Installation should refuse to install a second provider copy when the CLI is already available. Provider-managed installs should use provider defaults. CliHub-managed GitHub release installs should write under app data and add the CliHub shims directory to the user PATH only after a new managed install needs it.

## Acceptance criteria

- [ ] CliHub can install an unavailable CLI from a selected valid channel.
- [ ] Installation is blocked when the CLI command is already available locally.
- [ ] `npm`, `winget`, `choco`, `scoop`, and `installer-command` channels execute provider/default install behavior without relocating the installed files.
- [ ] `github-release` or app-managed binary installs write under `<dataDir>/clihub`.
- [ ] App-managed installs generate stable shims under `<dataDir>/clihub/shims`.
- [ ] The shims directory is added to user-level PATH only after an app-managed install requires it.
- [ ] PATH writes are deduplicated and never target system-level PATH.
- [ ] The current app process PATH is updated after a successful PATH write.
- [ ] Installation completion triggers discovery refresh.
- [ ] Tests cover blocked duplicate install, provider install command execution through a fake runner, managed binary layout, shim creation, user PATH write, and discovery refresh.

## Blocked by

- 02-refresh-cli-discovery-and-availability.md
- 03-model-install-channels-and-provider-parsing.md
