Status: ready-for-agent

# Import local Agent folders

## Parent

.scratch/agenthub-agent-management/PRD.md

## What to build

Add local folder import for AgentHub. The user selects a local agent folder and a single truth tool. AgentHub recursively scans only that folder, accepts files recognized by the selected adapter, copies native truth files into AgentHub library, records imported agents under a local-import source, and reports skipped files and conflicts.

After import, the original local folder is only source history. AgentHub does not track, sync, or rescan it automatically.

## Acceptance criteria

- [ ] The AgentHub import flow requires a local folder path and a single truth tool.
- [ ] Scanning is recursive inside the selected folder and does not scan outside that folder.
- [ ] A local-import source records source label, original path, truth tool, and import time.
- [ ] Imported native files are copied into AgentHub library and become the center truth files.
- [ ] Editing or deleting the original local folder after import does not change AgentHub records.
- [ ] Re-importing the same path and truth tool can merge into the existing local-import source.
- [ ] New slugs are imported, same-content duplicate slugs are skipped, and changed-content duplicate slugs require explicit conflict handling.
- [ ] Conflict handling supports overwrite existing center truth, rename imported agent, or skip.
- [ ] Imported center rows can open the copied native file and containing folder through the same local open flow used by other hubs.
- [ ] Tests cover recursive scan, source grouping, copying, detach-from-original behavior, skipped files, duplicate skip, changed-content conflict, overwrite, rename, and open file/folder actions.

## Blocked by

- .scratch/agenthub-agent-management/issues/01-build-agenthub-center-library.md
- .scratch/agenthub-agent-management/issues/03-add-agenthub-native-adapters-and-preview.md

