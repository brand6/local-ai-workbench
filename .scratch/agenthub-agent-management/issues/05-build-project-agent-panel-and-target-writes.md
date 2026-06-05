Status: ready-for-agent

# Build project Agent panel and target writes

## Parent

.scratch/agenthub-agent-management/PRD.md

## What to build

Add the project-side `Agent` panel for root/subproject groups and implement the first managed write path: selecting an AgentHub agent and target tool writes that tool's native agent/rule file under the current group, records a ProjectAgentTarget binding, and displays the target as current.

This slice should mirror SkillHub's project-side shape but write real native files instead of links.

## Acceptance criteria

- [ ] Each root/subproject group exposes an `Agent` entry next to existing project-local management entries.
- [ ] The Agent panel has `AgentHub Agent` and `本地 Agent` tabs.
- [ ] The `AgentHub Agent` tab lists center agents with source context, truth tool, truth role, name, description, slug, and compact row actions.
- [ ] Tool checkboxes only appear for tools that are enabled/available for the current project group and convertible by AgentHub.
- [ ] Enabling a target writes the fixed native file path for that tool and slug under the current `targetRootPath`.
- [ ] Enabling stores a ProjectAgentTarget binding with project id, target root path, tool id, agent id, output path, applied source hash, applied output hash, and applied time.
- [ ] New writes create parent directories as needed.
- [ ] Existing same-path unmanaged files are not overwritten in this slice; they return a conflict result for the follow-up conflict flow.
- [ ] The UI shows successful writes through the shared toast pattern and refreshes the panel state.
- [ ] Tests cover root and subproject target paths, visible target tools, native output content for all MVP tools, binding persistence, current status after write, conflict-on-existing-file, and UI checkbox behavior.

## Blocked by

- .scratch/agenthub-agent-management/issues/01-build-agenthub-center-library.md
- .scratch/agenthub-agent-management/issues/03-add-agenthub-native-adapters-and-preview.md

