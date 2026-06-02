Status: ready-for-agent

# Scan Codex and Claude sessions into the read-only index

## Parent

.scratch/local-ai-project-session-manager/PRD.md

## What to build

Implement Codex and Claude history scanning into the manager index. Scanners should parse local JSONL/session files, extract session title, optional summary, tool-native session id, cwd, updated time, source file, source format, and parser version, and record warnings without modifying source files.

This slice should let the backend build a reusable read-only session index from real or fixture Codex/Claude histories.

## Acceptance criteria

- [x] Codex session sources can be scanned into session index entries.
- [x] Claude session sources can be scanned into session index entries.
- [x] Existing summaries are stored when present; missing summaries remain absent.
- [x] Missing titles use a fallback title and record a parser warning.
- [x] Updated time comes from session content when available and falls back to source file mtime.
- [x] Files or lines with parse errors do not abort the whole scan.
- [x] Sessions missing non-recoverable required fields are skipped or marked non-resumable with a warning.
- [x] Scan results include indexed count, skipped count, and warning count.
- [x] Tests cover parser success, missing fields, malformed JSONL, timestamp fallback, and read-only behavior.

## Blocked by

- .scratch/local-ai-project-session-manager/issues/02-build-sqlite-index-and-core-models.md
- .scratch/local-ai-project-session-manager/issues/03-implement-codex-claude-tool-adapters.md

## Comments

- 2026-06-01：已实现 Codex/Claude JSONL 只读扫描、字段抽取、fallback title、mtime fallback、parser warning 和 scan count。验证覆盖成功解析、缺字段、坏 JSONL 和 warning。
