Status: ready-for-human

# Research wshobson agents harness adapters

## Parent

.scratch/pluginhub-plugin-management/PRD.md

## What to build

Document how `wshobson/agents` supports each target harness before implementing PluginHub native package generation. Start from `.scratch/pluginhub-plugin-management/wshobson-harness-research.md`, then verify it against the implementation checkout and turn it into the final compatibility note or ADR-style section. The final matrix should map source inputs, generated artifacts, install commands, limitations, and unsupported cases for Claude Code, Codex, Cursor, OpenCode, Gemini CLI, and Copilot.

This slice is intentionally research-first. It should prevent PluginHub from hard-coding a false assumption that every tool can consume the same plugin directory layout.

## Acceptance criteria

- [x] The researched matrix identifies the source-of-truth paths in `wshobson/agents`.
- [x] The researched matrix records committed versus generated artifacts for each harness.
- [x] The researched matrix records install semantics for Claude Code, Codex, Cursor, OpenCode, Gemini CLI, and Copilot.
- [x] The researched matrix records component transformations such as Codex commands-to-skills, Codex TOML agents, OpenCode permission blocks, Gemini TOML commands, Cursor reuse of Claude structures, and model alias mapping.
- [x] The researched matrix identifies which behavior PluginHub can implement by reading source manifests, which behavior should call an upstream generator, and which behavior should wait for a local adapter.
- [x] The researched matrix calls out tool-specific constraints such as Codex skill body caps, context file caps, and unsupported hook or permission features.
- [x] The researched matrix is linked from the PluginHub PRD or issue comments so future implementation tickets do not repeat the same external research.
- [x] No project installation behavior is implemented in this issue.

## Blocked by

None - can start immediately

## Implementation notes

2026-06-05: Harness matrix is maintained in `.scratch/pluginhub-plugin-management/wshobson-harness-research.md` and linked from the PRD implementation status.
