Status: ready-for-human

# Model install channels and provider parsing

## Parent

.scratch/clihub-cli-management/PRD.md

## What to build

Add install channel modeling for built-in and custom CLIs. Built-in CLIs can carry multiple known channels. Users can add channels to built-in CLIs. Custom CLIs can be added only from a verified local executable path or from a single online install command that parses into a supported provider or installer-command.

This slice should parse and validate channels but should not execute install or update commands yet.

## Acceptance criteria

- [ ] Built-in CLI entries can store multiple install channels.
- [ ] Supported providers include `npm`, `github-release`, `winget`, `choco`, `scoop`, and `installer-command`.
- [ ] A custom CLI cannot be created from only a command name.
- [ ] A custom local-path CLI validates that the executable path exists.
- [ ] A custom local-path CLI is marked non-updatable.
- [ ] A custom online install command is parsed into structured provider metadata or rejected.
- [ ] Supported command parsing covers common npm, winget, choco, scoop, and single installer-command shapes.
- [ ] Complex shell, pipe, redirection, `cmd /c`, `powershell -Command`, `curl | sh`, and `iwr | iex` commands are rejected for automatic execution.
- [ ] Tests cover valid built-in channels, valid custom local paths, valid custom online install commands, and rejected unsafe command shapes.

## Blocked by

- 01-build-clihub-center-inventory.md
