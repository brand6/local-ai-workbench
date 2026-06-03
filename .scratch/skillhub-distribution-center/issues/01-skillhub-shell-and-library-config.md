Status: ready-for-human

# SkillHub shell and library configuration

## Parent

.scratch/skillhub-distribution-center/PRD.md

## What to build

Add the first demoable SkillHub path: a top-bar `SkillHub` entry opens an independent page, the app persists SkillHub configuration under the selected data directory, and an empty SkillHub library can be listed through the API and UI.

This slice establishes the app-owned SkillHub root and library structure without importing skills yet. It should be possible to start the app with a temporary data directory, open `SkillHub`, and see an empty, persisted skill center.

## Acceptance criteria

- [ ] The top bar has a left-side `SkillHub` entry that opens a SkillHub page.
- [ ] SkillHub defaults to `<dataDir>/skillhub` and uses `<dataDir>/skillhub/library` as the default library directory.
- [ ] Settings exposes a configurable SkillHub directory without silently moving existing libraries.
- [ ] The backend stores and returns SkillHub configuration through the existing local API protection model.
- [ ] The backend exposes a SkillHub list endpoint that returns an empty list when no skills exist.
- [ ] The SkillHub page renders an empty state, search input, add skill entry, and disabled/empty update state without requiring imported skills.
- [ ] Tests cover default config initialization, config update, empty list API behavior, and UI navigation to the SkillHub page.

## Blocked by

None - can start immediately
