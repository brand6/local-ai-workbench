Status: ready-for-human

# Import GitHub sources into SkillHub

## Parent

.scratch/skillhub-distribution-center/PRD.md

## What to build

Implement GitHub source import into SkillHub. Users can import a GitHub repo or repo path, SkillHub resolves the source, scans valid skills, copies or materializes them into the library under `library/<owner-repo>/...`, and records source metadata for later update checks.

## Acceptance criteria

- [ ] The add-skill flow supports GitHub inputs: `owner/repo`, `owner/repo/path`, full GitHub URL, GitHub tree URL with branch/path, and SSH URL.
- [ ] GitHub imports use `owner-repo` as the source library group.
- [ ] An unspecified path scans the relevant repo content for valid skills.
- [ ] A specified path limits scanning to that path.
- [ ] The source record stores source type, owner, repo, branch or resolved revision, input path, resolved path, and current revision.
- [ ] Re-importing the same `owner-repo` namespace merges newly discovered skills.
- [ ] Re-importing a conflicting existing skill requires overwrite confirmation rather than creating a hash-suffixed source group.
- [ ] Imported GitHub skills appear in SkillHub with library relative paths and `SKILL.md` metadata.
- [ ] Network-dependent code is isolated so tests can use local Git fixtures or mocked fetch/clone behavior.
- [ ] Tests cover input parsing, source namespace reuse, path-limited import, merge import, overwrite confirmation, and import result display.

## Blocked by

- .scratch/skillhub-distribution-center/issues/01-skillhub-shell-and-library-config.md
