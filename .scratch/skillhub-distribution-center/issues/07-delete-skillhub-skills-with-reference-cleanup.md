Status: ready-for-human

# Delete SkillHub skills with reference cleanup

## Parent

.scratch/skillhub-distribution-center/PRD.md

## What to build

Implement SkillHub skill deletion. Deleting a center skill first scans project references, shows affected projects and tool targets, and after confirmation removes project links before deleting the SkillHub library directory and metadata.

## Acceptance criteria

- [ ] SkillHub list includes a delete action for each skill.
- [ ] Delete preview scans all project tool targets for links pointing to the selected SkillHub skill.
- [ ] Delete preview shows affected project names/paths and tool targets.
- [ ] Confirmed deletion removes affected project links before deleting center content.
- [ ] Confirmed deletion removes the SkillHub skill metadata and actual library directory.
- [ ] Deletion does not delete other same-name SkillHub skills from different sources.
- [ ] Broken or already-missing project links are reported but do not block deleting the center skill.
- [ ] Canceling deletion leaves project links, library content, and metadata unchanged.
- [ ] Tests cover deletion with no references, deletion with references, same-name unrelated skills, broken link cleanup, and cancel behavior.

## Blocked by

- .scratch/skillhub-distribution-center/issues/05-project-skill-management-panel-and-links.md
