Status: ready-for-agent

# Build AgentHub center library

## Parent

.scratch/agenthub-agent-management/PRD.md

## What to build

Build the first demoable AgentHub center path: a top-level `AgentHub` entry opens a center library page, the app persists AgentHub sources and native truth agent records, and an empty center library can be listed through the API and UI.

This slice establishes the app-owned AgentHub library and source grouping only. It should not import built-in agents, scan local folders, or write any project agent files yet.

## Acceptance criteria

- [ ] A top-level `AgentHub` entry is available next to the existing global hub/navigation entries.
- [ ] AgentHub persists an app-owned library root under the selected data directory.
- [ ] The backend stores AgentHub source records and agent records with stable `agentId`, stable `slug`, `sourceTruthTool`, `truthRole`, `sourceFormat`, `nativePath`, parsed projection, native metadata, source relative path, optional category, and content hash.
- [ ] The backend exposes an AgentHub list endpoint that returns sources and agents, grouped consistently with the existing Hub list patterns.
- [ ] The AgentHub page renders an empty state, search input, source grouping shell, and import/re-import entry points without requiring imported agents.
- [ ] Center rows show lightweight truth tool and truth role labels when records exist.
- [ ] AgentHub search covers name, description, slug, source label, truth tool, truth role, native path, source relative path, and category.
- [ ] Tests cover default library initialization, empty list API behavior, source/agent persistence, stable slug storage, search behavior, and UI navigation to AgentHub.

## Blocked by

None - can start immediately

