Status: ready-for-human

# Project agent tool targets

## Parent

.scratch/skillhub-distribution-center/PRD.md

## What to build

Add project-level agent tool targets. New projects let the user select tools during creation; existing projects infer enabled tools from known sessions and project structure. Enabled tools become the default target set for project skill management but do not create skill links by themselves.

## Acceptance criteria

- [ ] Project records can persist enabled agent tool targets.
- [ ] New project creation allows selecting agent tools from the app's project-visible tools.
- [ ] Existing projects infer enabled tools from session `toolId` values.
- [ ] Existing projects infer enabled tools from project traces such as `.codex`, `AGENTS.md`, `.claude`, `CLAUDE.md`, `.opencode`, `OPENCODE.md`, `.qwen`, `QWEN.md`, `.qoder`, `QODER.md`, and Copilot instruction traces.
- [ ] Inferred tools are enabled by default for display and default skill targeting.
- [ ] Enabling a tool target does not create or delete project skill links.
- [ ] The project detail page exposes a concise tool target status or edit path without crowding the session view.
- [ ] Tool skill directory mapping lives in the tool adapter layer and unsupported skill-target tools are shown as unsupported rather than guessed.
- [ ] Tests cover persistence, new project target selection, old project inference from sessions, old project inference from traces, and unsupported skill-target handling.

## Blocked by

None - can start immediately
