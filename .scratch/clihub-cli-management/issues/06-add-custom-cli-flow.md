Status: ready-for-human

# Add custom CLI flow

## Parent

.scratch/clihub-cli-management/PRD.md

## What to build

Build the user-facing custom CLI flow. The flow should stay concise: users add either a local executable path or an online install command. CliHub should not infer from a bare command name and should not add custom CLIs to the project detail tool list in this version.

## Acceptance criteria

- [ ] CliHub provides an add custom CLI action.
- [ ] The user can add a custom CLI from a local executable path.
- [ ] Local executable path input validates existence before saving.
- [ ] The user can add a custom CLI from a supported online install command.
- [ ] Bare command-name input fails with a clear message.
- [ ] Custom CLI rows display their source as local-path or custom channel.
- [ ] Custom local-path CLIs do not show update actions.
- [ ] Custom install-command CLIs show install/update only when their parsed channel supports those actions.
- [ ] Custom CLIs do not appear in project detail tools, session groups, SkillHub, McpHub, or HookHub targets.
- [ ] Tests cover successful local-path add, successful online-command add, rejected bare command name, rejected unsafe command, and project detail remaining unchanged.

## Blocked by

- 01-build-clihub-center-inventory.md
- 03-model-install-channels-and-provider-parsing.md
