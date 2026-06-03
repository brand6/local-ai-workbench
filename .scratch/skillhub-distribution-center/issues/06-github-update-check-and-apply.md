Status: ready-for-human

# GitHub update check and apply

## Parent

.scratch/skillhub-distribution-center/PRD.md

## What to build

Add manual GitHub update checking and source-level update application. The SkillHub page provides a “检查更新” button, displays update status by GitHub source, previews changed skills and project impact, applies confirmed updates to the SkillHub library, and handles moved or deleted distributed skills.

## Acceptance criteria

- [ ] SkillHub has a “检查更新” button that checks all GitHub sources on demand.
- [ ] Local sources are excluded from update checks.
- [ ] Update status is displayed by source and can be expanded to show affected skills.
- [ ] Update execution is source-level; users cannot update only part of a GitHub source.
- [ ] Update preview classifies added, changed, deleted, and moved skills.
- [ ] Git rename detection is used to identify moved skill directories when possible.
- [ ] Same folder name is offered as a fallback migration candidate when rename detection is unavailable or inconclusive.
- [ ] Confirmed moves keep the same `skillId` and update the source relative path and library content.
- [ ] Changed skills update the real SkillHub library directory without rebuilding project links.
- [ ] Deleted skills that are distributed to projects are marked as destructive and show affected projects/tools.
- [ ] Confirmed destructive updates remove affected project links before removing the SkillHub skill record/content.
- [ ] Canceling a destructive update leaves the current source and library unchanged.
- [ ] Tests cover no-update, added skill, changed skill, Git rename move, same-name migration candidate, deleted undistributed skill, deleted distributed skill, and canceled destructive update.

## Blocked by

- .scratch/skillhub-distribution-center/issues/03-import-github-sources-into-skillhub.md
- .scratch/skillhub-distribution-center/issues/05-project-skill-management-panel-and-links.md
