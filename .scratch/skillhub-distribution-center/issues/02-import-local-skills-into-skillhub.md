Status: ready-for-human

# Import local skills into SkillHub

## Parent

.scratch/skillhub-distribution-center/PRD.md

## What to build

Implement local path import into SkillHub. Users can add a local single skill directory, a `skills` directory, or a parent directory that contains `skills`; valid skills are copied into the SkillHub library and appear in the SkillHub list with folder name, metadata, source type, and library relative path.

## Acceptance criteria

- [ ] A user can choose or enter a local path from the SkillHub add-skill flow.
- [ ] A selected single skill directory containing `SKILL.md` is copied to `library/skills/<skillFolder>`.
- [ ] A selected `skills` directory imports contained skills under `library/skills/...` without creating `library/skills/skills`.
- [ ] A selected parent directory containing `skills` preserves the parent grouping under `library/<group>/skills/...`.
- [ ] Local imports copy actual files into SkillHub and do not keep the original path as a runtime dependency.
- [ ] Only `SKILL.md` is recognized as a valid skill marker.
- [ ] Parent skill directories win over nested `SKILL.md` files; nested markers are ignored once the parent is imported.
- [ ] Invalid structures are skipped and surfaced in the import result without failing the whole import.
- [ ] Same-name skills from different library relative paths can coexist in SkillHub.
- [ ] Tests cover single skill import, `skills` directory import, parent directory import, nested `SKILL.md`, invalid markers, duplicate folder names, and list display after import.

## Blocked by

- .scratch/skillhub-distribution-center/issues/01-skillhub-shell-and-library-config.md
