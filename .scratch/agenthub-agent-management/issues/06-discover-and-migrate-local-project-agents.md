Status: ready-for-agent

# Discover and migrate local project Agents

## Parent

.scratch/agenthub-agent-management/PRD.md

## What to build

Implement the project `本地 Agent` tab. AgentHub should scan the current root/subproject group for MVP tool native agent files, classify each file as managed or unmanaged, and let unmanaged files migrate into AgentHub using the same migration target pattern as SkillHub.

Migrating a project-local unmanaged agent copies it into AgentHub library and immediately registers the original project file as a managed target binding.

## Acceptance criteria

- [ ] The project local-agent scan covers `.claude/agents/*.md`, `.codex/agents/*.toml`, `.cursor/rules/*.mdc`, `.opencode/agents/*.md`, and `.qwen/agents/*.md` under the current `targetRootPath`.
- [ ] Local project files with existing ProjectAgentTarget bindings are shown as managed.
- [ ] Recognized local project files without AgentHub bindings are shown as unmanaged.
- [ ] Invalid or unparseable files are shown with a non-destructive status and are not silently migrated.
- [ ] Unmanaged migration supports the SkillHub-style target choices: migrate into an existing source or create a new local-import source.
- [ ] Migrating copies the native truth file into AgentHub library and creates an AgentHub agent using that file's tool as source truth.
- [ ] After migration, the original project file is registered as managed with current status instead of being duplicated or overwritten.
- [ ] Same slug conflicts in the chosen source require confirmation and support overwrite, rename, or cancel.
- [ ] Tests cover managed/unmanaged classification, per-tool scan paths, invalid file handling, migration into existing source, migration into new source, immediate binding registration, same-slug conflict handling, and UI tab behavior.

## Blocked by

- .scratch/agenthub-agent-management/issues/04-import-local-agent-folders.md
- .scratch/agenthub-agent-management/issues/05-build-project-agent-panel-and-target-writes.md

