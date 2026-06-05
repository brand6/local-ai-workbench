Status: ready-for-agent

# Add AgentHub native adapters and conversion preview

## Parent

.scratch/agenthub-agent-management/PRD.md

## What to build

Build the server-side AgentHub adapter layer for MVP tools. The adapters should parse native truth files, render target tool files, compute target paths, detect supported files, and return conversion previews that can be reused by center import, project writes, local migration, and tests.

This slice establishes conversion behavior but should not yet add project writeback UI.

## Acceptance criteria

- [ ] AgentHub has server-side adapters for Claude Markdown subagents, Codex custom-agent TOML, Cursor MDC rules, OpenCode subagents, and Qwen SubAgent Markdown.
- [ ] Each adapter can parse native files into a common projection with name, description, body/instructions, slug candidate, native metadata, and parse warnings.
- [ ] Each adapter can render a target native file from an AgentHub agent and target context.
- [ ] Each adapter returns the fixed project target path for its tool and slug.
- [ ] Same-tool rendering preserves supported native fields from the truth file, such as Cursor rule metadata, OpenCode mode/color, Qwen tools, and Codex developer instructions.
- [ ] Cross-tool rendering uses the parsed common projection and drops unsupported fields.
- [ ] Conversion preview reports target tool, target path, action kind, rendered summary, preserved native fields, and ignored fields for tests/API use.
- [ ] The UI does not need a full diff in this slice, but API responses make preview content available for future display.
- [ ] Tests cover parse/render/preview for all MVP adapters, same-tool preservation, cross-tool conversion, invalid input, and stable slug derivation.

## Blocked by

- .scratch/agenthub-agent-management/issues/01-build-agenthub-center-library.md

