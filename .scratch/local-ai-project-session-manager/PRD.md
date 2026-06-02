Status: ready-for-agent

# PRD: 本地 AI 项目与会话管理系统

## Problem Statement

用户在本机使用多个 AI CLI 工具处理同一批本地项目，目前缺少一个统一入口来回答这些问题：某个项目用过哪些 AI 工具、每个工具有哪些历史会话、这些会话是否还能恢复、应该从哪个目录继续工作。

现状下，Codex、Claude 等工具各自保存全局会话历史，项目目录内也可能存在工具配置痕迹。用户需要手动记忆项目路径、工具、会话和恢复方式。项目存在父子目录结构时，历史会话可能分散在根目录和子目录的不同 cwd 下，进一步增加查找和恢复成本。

用户希望打开一个项目后，立即看到该项目相关的 AI 工具、根目录/子项目会话分组、会话标题、最近更新时间、摘要，并能直接启动新会话或 resume 历史会话。用户也明确需要后续支持项目外部移动后的会话重新匹配，使历史会话仍能显示并恢复到新项目位置。

## Solution

构建一个本地运行的项目与 AI 会话管理系统。MVP-A 交付本地 Web UI 和 Node/TypeScript 后端，支持 Codex 与 Claude 的只读会话索引、项目添加、项目扫描、会话展示、新会话启动和历史会话恢复。

系统启动后读取本地索引，立即展示上次扫描和添加过的项目与会话。用户可以手动添加项目目录，也可以手动触发项目候选扫描。扫描以 AI 工具痕迹和全局 AI 会话命中为主，扫描结果只作为候选，用户确认后才进入正式项目列表。

项目详情页按根目录和子项目分组展示会话。每个分组提供一个“新会话”按钮，点击后选择 Codex 或 Claude，并在对应 cwd 打开新终端启动 CLI。历史会话按工具分组，工具按会话数量倒序，工具内会话按最近更新时间倒序。每条会话显示标题、更新时间、已有摘要和恢复按钮。

MVP-A 不直接修改或删除 Codex/Claude 原始会话文件。MVP-B 增加项目重定位和会话级 cwd 写回能力，并逐步接入 opencode、qwen、qoder、copilot 等工具。MVP-B 的每个新增工具必须完整支持新会话、历史扫描和 resume 后，才作为完整工具进入主项目页。

## User Stories

1. As a local AI tool user, I want to open the manager and immediately see my previously added projects, so that I can continue work without rescanning.
2. As a local AI tool user, I want to choose where the manager stores its own data, so that I can keep indexes and config on the disk I prefer.
3. As a local AI tool user, I want the selected data directory remembered between launches, so that I do not need to reconfigure it every time.
4. As a local AI tool user, I want to manually add a project directory, so that I can start managing a known project directly.
5. As a local AI tool user, I want to manually scan selected disks or directories for AI-related project candidates, so that I can discover existing projects without scanning automatically.
6. As a local AI tool user, I want scan results to remain candidates until I confirm them, so that irrelevant directories do not pollute my project list.
7. As a local AI tool user, I want scanning to prioritize AI tool traces and AI session hits, so that non-AI Git repositories are not treated as primary results.
8. As a local AI tool user, I want a project candidate to show detected tools and session counts, so that I can decide whether to add it.
9. As a local AI tool user, I want candidates with parent and child project paths grouped clearly, so that I can understand nested project structures before adding them.
10. As a local AI tool user, I want batch adding to keep parent projects as top-level entries when parent candidates exist, so that child paths become internal groupings rather than duplicate top-level projects.
11. As a local AI tool user, I want only confirmed projects in the main project list, so that scan noise stays out of my working view.
12. As a local AI tool user, I want to remove a project from the manager without deleting any project files, so that I can clean up my manager safely.
13. As a local AI tool user, I want a top-level project with child session groups to show a child-count marker, so that I can see which projects contain nested work.
14. As a local AI tool user, I want to open a project and see root and subproject groups, so that cwd-specific AI work is organized by where it happened.
15. As a local AI tool user, I want root and subproject groups to use friendly labels and full-path details, so that I can identify them quickly without losing path precision.
16. As a local AI tool user, I want subproject groups sorted by newest activity, so that the most relevant nested work appears first.
17. As a local AI tool user, I want a project-level include-subdirectories switch, so that I can control whether child cwd sessions appear in the project page.
18. As a local AI tool user, I want include-subdirectories to turn on automatically when parent and child project paths are both added, so that previously visible child sessions do not disappear.
19. As a local AI tool user, I want to manually turn include-subdirectories off, so that I can temporarily focus on the project root only.
20. As a local AI tool user, I want each root or subproject group to have one “new session” button, so that the UI stays compact.
21. As a local AI tool user, I want the new-session flow to let me choose Codex or Claude, so that I can pick the AI CLI tool for the current task.
22. As a local AI tool user, I want a new Codex session to start in the selected root or subproject cwd, so that Codex has the right project context.
23. As a local AI tool user, I want a new Claude session to start in the selected root or subproject cwd, so that Claude has the right project context.
24. As a local AI tool user, I want unavailable CLI tools to be disabled, so that I do not attempt launches that will fail.
25. As a local AI tool user, I want historical sessions grouped by tool under each root or subproject group, so that I can compare Codex and Claude histories.
26. As a local AI tool user, I want tool groups sorted by session count, so that the most-used tool for that project area is most prominent.
27. As a local AI tool user, I want sessions sorted by recent activity, so that I can resume the latest relevant work quickly.
28. As a local AI tool user, I want each session card to show title and last updated time, so that I can identify the right session quickly.
29. As a local AI tool user, I want session cards to show existing summaries when available, so that I can understand prior work without opening the full chat.
30. As a local AI tool user, I want sessions without summaries to omit the summary row, so that the UI does not invent or display noisy fallback text.
31. As a local AI tool user, I want to expand a session card for metadata, so that I can inspect the tool, session id, cwd, source file, and resume status.
32. As a local AI tool user, I want to resume a Codex session directly from its card, so that I can continue a previous Codex conversation.
33. As a local AI tool user, I want to resume a Claude session directly from its card, so that I can continue a previous Claude conversation.
34. As a local AI tool user, I want resume buttons disabled when session ids or cwd are invalid, so that I do not launch broken sessions.
35. As a local AI tool user, I want the manager to use the historical session cwd for resume, so that the AI tool continues from the same project area.
36. As a local AI tool user, I want the manager to check that cwd exists before launching a new or resumed session, so that missing paths are surfaced clearly.
37. As a local AI tool user, I want the manager to open CLI sessions in a new terminal window by default, so that each AI session is isolated.
38. As a local AI tool user, I want the terminal strategy to be configurable later, so that I can choose all-new windows, per-tool windows, or per-project windows.
39. As a local AI tool user, I want the manager to prefer Windows Terminal and fall back to PowerShell, so that launching works on my Windows machine.
40. As a local AI tool user, I want a second app launch to show cached project and session data immediately, so that refresh is not required just to view known history.
41. As a local AI tool user, I want opening a project page to perform a lightweight session refresh, so that recently created sessions can appear without full rescans.
42. As a local AI tool user, I want manual refresh controls, so that I can force the manager to update the current project or global session index.
43. As a local AI tool user, I want parser failures to be recorded as warnings without stopping the scan, so that one bad history file does not block the whole system.
44. As a local AI tool user, I want scan summaries to show indexed counts and warning counts, so that I can judge scan quality.
45. As a local AI tool user, I want to filter sessions by title and summary, so that I can find known sessions without full-text indexing.
46. As a local AI tool user, I want MVP-A to leave Codex and Claude original session files unchanged, so that the first version is safe and reversible.
47. As a local AI tool user, I want MVP-A not to delete or hide sessions, so that it remains a read-only history viewer and launcher.
48. As a local AI tool user, I want MVP-B to support project relocation after I move a project externally, so that old sessions can be re-associated with the new project path.
49. As a local AI tool user, I want relocation to preview affected sessions and files, so that I know exactly what will change.
50. As a local AI tool user, I want relocation to back up original session files before writing, so that I can recover if a rewrite is wrong.
51. As a local AI tool user, I want relocation to modify only session-level cwd fields, so that message content and tool outputs are not rewritten.
52. As a local AI tool user, I want MVP-B to add opencode support only when it can start, scan, and resume sessions, so that tool behavior is consistent.
53. As a local AI tool user, I want MVP-B to add qwen support only when it can start, scan, and resume sessions, so that tool behavior is consistent.
54. As a local AI tool user, I want MVP-B to add qoder support only when it can start, scan, and resume sessions, so that tool behavior is consistent.
55. As a local AI tool user, I want MVP-B to add copilot support only when it can start, scan, and resume sessions, so that tool behavior is consistent.
56. As a developer of the manager, I want all tools implemented through adapters, so that adding future AI tools does not require rewriting core project logic.
57. As a developer of the manager, I want parser versions recorded in the index, so that changed parsers can trigger rebuilds when needed.
58. As a developer of the manager, I want API calls protected by a local token, so that unrelated browser pages cannot trigger local file or terminal operations.
59. As a developer of the manager, I want tests to verify launch command construction without starting real CLIs, so that automation remains deterministic.
60. As a developer of the manager, I want real local Codex and Claude samples used in manual acceptance, so that the system proves it works on the target machine.

## Implementation Decisions

- Build a local Web UI and a local Node/TypeScript backend, served through one user-facing command. Development may run frontend and backend separately, but normal use has one startup path.
- The local backend listens only on localhost and uses a startup-generated API token that is transparent to the user.
- The first run initializes a user-selected data directory. A lightweight bootstrap configuration records the selected data directory and can be overridden with a startup argument.
- SQLite is the primary index store. JSON configuration stores app settings and tool command paths. Configuration saves maintain a simple backup copy.
- The index stores confirmed projects, session index entries, scan sources, scan runs, scan candidates, and parser warnings.
- Confirmed projects are the only entries shown in the main project list. Scan candidates are saved as recent scan results but do not become managed projects until confirmed.
- Project scanning is manually triggered. It can scan selected directories, selected drives, or all local fixed disks with default ignore rules.
- Project discovery prioritizes AI signals and global AI session hits. General project boundary signals may help group results but do not alone make a Git repository a primary AI project result.
- Subprojects are not independent top-level entities in the MVP data model. They are dynamic project-detail groups derived from session cwd values under a confirmed top-level project.
- When an added parent project covers an already-added child project, the child project is removed from the top-level project list and represented as an internal subproject group.
- When a user attempts to add a child directory under an existing project, the manager does not create a new top-level project. It enables include-subdirectories for the parent and navigates to the relevant internal group.
- Include-subdirectories is a project-level display setting. It controls whether sessions under child cwd paths appear in the parent project page.
- The project list shows only top-level projects. A project with actual child session groups displays a child-count marker.
- The project detail view groups sessions first by root or subproject cwd, then by tool, then by session.
- Root groups are fixed at the top. Child groups sort by newest session activity. Tool groups sort by session count, with latest session time as the tie-breaker. Sessions sort by updated time descending.
- Each root or subproject group has one new-session button. Clicking it opens a tool picker for supported tools in MVP-A.
- MVP-A supports Codex and Claude only. opencode, qwen, qoder, and copilot are deferred to MVP-B.
- Codex and Claude each have a tool adapter that detects CLI availability, discovers session sources, scans sessions, builds new-session launch commands, and builds resume launch commands.
- New Codex sessions start by launching Codex in the selected group cwd. New Claude sessions start by launching Claude in the selected group cwd.
- Codex resume launches the Codex resume command with the tool-native session id. Claude resume launches the Claude resume command with the tool-native session id.
- Resume uses the historical session cwd. New sessions use the selected root or subproject group cwd.
- Launch actions verify cwd existence before attempting to start a terminal.
- Windows terminal launching prefers Windows Terminal as the window host and falls back to PowerShell. The default launch mode is always a new window.
- Terminal open mode is configurable in the product model as all-new windows, per-tool windows, or per-project windows. Only all-new windows must be fully implemented in MVP-A if reliable directed tab/window reuse is not available.
- Session cards show title, last updated time, optional existing summary, and resume status. No generated or inferred summary is created in MVP-A.
- Session title is expected to exist. If parsing cannot find one, the card uses a fallback title and records a parser warning.
- Session updated time comes from the last valid event or metadata timestamp when available, and falls back to source file modification time.
- Session cards can expand to lightweight metadata. MVP-A does not include a full chat transcript viewer.
- MVP-A does not delete, hide, edit, or rewrite AI tool sessions. Codex and Claude source histories are read-only except when the external CLI itself writes during new or resumed sessions.
- Parser failures do not fail the whole scan. Bad files, bad lines, missing fields, and fallback behavior are recorded as warnings.
- MVP-B adds project relocation and session-level cwd writeback. It requires user-specified old and new roots, a preview, backups, confirmation, and a post-write index rebuild.
- MVP-B cwd writeback modifies only tool-format fields that represent the session working directory. It does not rewrite user messages, assistant messages, tool input, tool output, or arbitrary strings.
- MVP-B adds future tool adapters one by one. A future tool only enters the primary project page when new session, historical scan, and resume all work for that tool.

## Testing Decisions

- Tests should verify externally observable behavior at the highest practical seam: parser outputs, project grouping outputs, API responses, and launch command construction.
- Parser unit tests cover Codex and Claude samples, including session id, cwd, title, optional summary, updated time, source file, parser version, and source format.
- Parser resilience tests cover malformed JSONL, missing summary, missing title, missing cwd, missing session id, and timestamp fallback.
- Path matching tests cover normalized case, trailing separators, Windows extended path prefixes, exact matching, include-subdirectories matching, and path-boundary safety.
- Project management tests cover manual project add, project removal from the manager, parent-child auto-merge, child add under existing parent, batch candidate add, and candidate persistence.
- Grouping tests cover root-first ordering, child group ordering by latest session, tool ordering by session count, and session ordering by updated time.
- API tests cover projects, scan runs, candidates, tool status, project detail, session refresh, new-session launch requests, resume requests, settings, and token rejection.
- Launch tests build terminal commands without starting real terminals or CLIs.
- UI tests cover first-run setup, empty project list, cached second launch, project child-count badges, project detail grouping, session card expansion, missing-summary rendering, disabled resume states, and parser warning display.
- Manual acceptance must run against real local Codex and Claude histories on the target Windows machine.
- Manual acceptance must prove that a real project can be added or discovered, its historical sessions appear, a new Codex and Claude session can be launched, and at least one Codex and one Claude historical session can be resumed.
- MVP-A acceptance must verify that no Codex or Claude original session files are directly modified by scanning, indexing, project addition, or project display.
- MVP-B relocation tests must verify preview accuracy, backup creation, constrained cwd-only rewrite, index rebuild, and resume behavior after rewrite.

## Out of Scope

- MVP-A does not support opencode, qwen, qoder, copilot, Gemini CLI, Cursor, Aider, or arbitrary user-defined tools.
- MVP-A does not support project relocation or cwd writeback.
- MVP-A does not delete, hide, rename, edit, or archive individual sessions.
- MVP-A does not provide a complete chat transcript viewer.
- MVP-A does not provide full-text search over complete messages or tool outputs.
- MVP-A does not auto-scan all disks on startup.
- MVP-A does not sync to cloud services.
- MVP-A does not package as a desktop application.
- MVP-A does not provide multi-user accounts or remote access.
- MVP-A does not generate AI summaries for sessions.
- MVP-A does not write project-local metadata into managed project directories.

## Further Notes

- UI language should default to Chinese. Internal code identifiers and API names can remain English.
- The product should distinguish clearly between safe read-only indexing in MVP-A and high-risk source rewrite operations in MVP-B.
- Session history ownership remains with each AI tool. The manager is a local index, launcher, and recovery aid, not a replacement for Codex or Claude.
- The implementation should keep tool-specific behavior inside adapters from the start, because MVP-B adds several additional CLI tools.
- The initial local issue tracker status for this PRD is `ready-for-agent`.
