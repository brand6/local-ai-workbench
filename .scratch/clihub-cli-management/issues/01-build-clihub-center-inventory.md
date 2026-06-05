Status: ready-for-human

# Build CliHub center inventory

## Parent

.scratch/clihub-cli-management/PRD.md

## What to build

Build the top-level `CliHub` center page and the app-owned CLI inventory model. The user should be able to open CliHub next to SkillHub, McpHub, and HookHub, see built-in CLI entries grouped by purpose, and distinguish project tool CLIs from function and dependency CLIs.

This slice establishes the center inventory only. It should not install, update, or change PATH.

## Acceptance criteria

- [ ] A top-level `CliHub` entry appears alongside existing Hub entries.
- [ ] CliHub lists built-in project tool CLIs: `codex`, `claude`, `opencode`, `qwen`, `qoder`, and `copilot`.
- [ ] CliHub lists built-in function CLIs: `lark-cli`, `gh`, and `playwright`.
- [ ] CliHub lists built-in dependency CLIs: `node`, `npm`, and `git`.
- [ ] Each CLI row shows display name, command names, CLI kind, source state, availability state, version state, and update state placeholders.
- [ ] CliHub has no uninstall action.
- [ ] `AppConfig.tools.command` behavior is not changed.
- [ ] API and UI tests cover listing grouped built-in CLI entries.

## Blocked by

None - can start immediately
