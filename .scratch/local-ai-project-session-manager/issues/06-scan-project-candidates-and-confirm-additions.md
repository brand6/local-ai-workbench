Status: ready-for-agent

# Scan project candidates and confirm additions

## Parent

.scratch/local-ai-project-session-manager/PRD.md

## What to build

Implement manual project candidate scanning. Users choose scan ranges such as a directory, drive, or all fixed local disks. The scanner applies ignore rules, prioritizes AI traces and global AI session hits, shows candidates with detected tools/session counts, and requires user confirmation before adding projects.

This slice should produce a scan results page where candidates can be reviewed and added.

## Acceptance criteria

- [x] Users can manually start a scan for selected directories, drives, or all fixed local disks.
- [x] The scanner applies default ignore rules for system, dependency, cache, and build directories.
- [x] AI tool traces and indexed AI session hits are primary discovery signals.
- [x] General project boundary signals help grouping but do not alone promote a non-AI project into the main result set.
- [x] Scan candidates show path, detected tools, session counts, and child candidate information when applicable.
- [x] Candidates are persisted as recent scan results but do not appear in the project list until confirmed.
- [x] Users can confirm one or more candidates to add them as managed projects.
- [x] Tests cover scan filtering, candidate persistence, AI-first discovery, and confirmed-add behavior.

## Blocked by

- .scratch/local-ai-project-session-manager/issues/02-build-sqlite-index-and-core-models.md
- .scratch/local-ai-project-session-manager/issues/04-scan-codex-claude-sessions-into-readonly-index.md
- .scratch/local-ai-project-session-manager/issues/05-add-and-remove-managed-projects.md

## Comments

- 2026-06-01：已实现手动目录/驱动/all-fixed 扫描入口、默认忽略规则、AI trace/session hit 候选、候选持久化和确认添加。验证覆盖 AI-first 候选和确认添加。
