Status: ready-for-agent

# Validate MVP-A end-to-end on the local machine

## Parent

.scratch/local-ai-project-session-manager/PRD.md

## What to build

Run the MVP-A acceptance pass against the real local Windows environment and real Codex/Claude histories. This is a human-in-the-loop validation issue because it launches actual local CLIs, opens real terminals, and confirms that the manager works with the user's existing session libraries.

This slice should produce documented acceptance evidence and any follow-up defects found during local validation.

## Acceptance criteria

- [ ] The app starts from a clean data directory and completes first-run setup.
- [ ] Real local Codex and Claude session sources are scanned.
- [ ] At least one real project is added manually or through candidate scanning.
- [ ] The project detail page shows historical sessions grouped by root/subproject and tool.
- [ ] A new Codex session launches in the selected cwd.
- [ ] A new Claude session launches in the selected cwd.
- [ ] At least one Codex historical session resumes successfully.
- [ ] At least one Claude historical session resumes successfully.
- [ ] Verification confirms scanning/indexing did not directly modify Codex or Claude original session files.
- [ ] Any failures are documented with reproduction steps and proposed follow-up issues.

## Blocked by

- .scratch/local-ai-project-session-manager/issues/01-initialize-local-app-shell-and-data-dir.md
- .scratch/local-ai-project-session-manager/issues/02-build-sqlite-index-and-core-models.md
- .scratch/local-ai-project-session-manager/issues/03-implement-codex-claude-tool-adapters.md
- .scratch/local-ai-project-session-manager/issues/04-scan-codex-claude-sessions-into-readonly-index.md
- .scratch/local-ai-project-session-manager/issues/05-add-and-remove-managed-projects.md
- .scratch/local-ai-project-session-manager/issues/06-scan-project-candidates-and-confirm-additions.md
- .scratch/local-ai-project-session-manager/issues/07-apply-parent-child-project-grouping-rules.md
- .scratch/local-ai-project-session-manager/issues/08-build-project-list-and-chinese-homepage.md
- .scratch/local-ai-project-session-manager/issues/09-build-project-detail-session-grouping.md
- .scratch/local-ai-project-session-manager/issues/10-launch-new-ai-sessions.md
- .scratch/local-ai-project-session-manager/issues/11-resume-historical-ai-sessions.md
- .scratch/local-ai-project-session-manager/issues/12-refresh-index-and-surface-parser-warnings.md
