Status: ready-for-human

# Project skill management panel and links

## Parent

.scratch/skillhub-distribution-center/PRD.md

## What to build

Add the project skill management entry next to the project refresh action. The right-side panel lists SkillHub skills, shows library relative paths, lets users enable skills for all project tools or specific tools, creates and removes one-layer project links, and handles same-name replacement.

## Acceptance criteria

- [ ] Project detail has a “技能” or “项目技能” button next to “刷新项目”.
- [ ] The button opens a right-side project skill management panel.
- [ ] The panel lists SkillHub skills with folder name, `SKILL.md` display metadata, source information, and library relative path.
- [ ] The panel supports search over folder name, `SKILL.md` name, description, library relative path, and source.
- [ ] A skill row has a primary checkbox and an expand action.
- [ ] Checking the primary checkbox enables the skill for all enabled and supported project tool targets.
- [ ] Expanding the skill allows selecting individual tool targets.
- [ ] The primary checkbox shows indeterminate when only some selected tool targets use the skill.
- [ ] Project links use the skill folder name and point to the SkillHub library real directory.
- [ ] Windows creates directory junctions; non-Windows creates symlinks; link creation never falls back to copy.
- [ ] Unchecking a skill removes all project links for that skill.
- [ ] Unchecking a single tool removes only that tool's link.
- [ ] Selecting a same-name skill in a project/tool target prompts to replace the existing link.
- [ ] Replacing a same-name skill deletes only the old link and creates the new link; it does not delete the old SkillHub skill.
- [ ] Link creation failures are shown to the user with the affected project, tool, and target path.
- [ ] Tests cover all-tools enable, per-tool enable, indeterminate state, link target correctness, no-copy failure behavior, link removal, and same-name replacement.

## Blocked by

- .scratch/skillhub-distribution-center/issues/02-import-local-skills-into-skillhub.md
- .scratch/skillhub-distribution-center/issues/03-import-github-sources-into-skillhub.md
- .scratch/skillhub-distribution-center/issues/04-project-agent-tool-targets.md
