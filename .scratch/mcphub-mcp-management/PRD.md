Status: ready-for-human

# PRD: McpHub MCP 管理中心与项目 MCP 分发

## Problem Statement

用户在本机同时使用 Claude Code、Codex、OpenCode 等多个 AI coding 工具，每个工具都有自己的 MCP 配置位置和格式。相同的 MCP server 往往需要在多个项目、多个工具里重复维护；已有项目里也可能已经存在手写的 `.mcp.json`、`.codex/config.toml` 或 `opencode.json`。用户希望像 SkillHub 管理技能一样管理 MCP：有一个全局中心库，有项目上下文里的启用入口，并且能把本地已有配置迁移到中心库。

项目当前已经支持 root/subproject 会话分组和项目内 SkillHub 管理。MCP 管理需要沿用这个项目/子项目语义：顶部 Hub 入口只管理中心库，项目详情中的每个 root/subproject group 才管理该工作目录实际使用的 MCP。否则父项目和子项目会把 MCP 配置写到错误目录，或者让用户无法分辨某个配置到底对哪个工作目录生效。

MCP 配置格式也不能直接按工具原样存储。Claude Code、Codex 和 OpenCode 对同一类 MCP server 的配置字段和文件结构不同；如果 McpHub 保存多份成品配置，后续导入、更新和迁移会迅速变成格式同步问题。McpHub 应保存规范化核心模型，分发时按目标工具结构化写入。

## Solution

新增 `McpHub`。顶部 `McpHub` 是全局中心库入口，只管理 MCP server 定义、内置 MCP、JSON 导入、编辑和删除；它不关心项目，也不显示任何项目本地 MCP。

项目详情中的每个 root/subproject group 新增一个 `MCP` 入口。点击后打开项目 MCP 管理面板，面板包含两个 tab：

- `本地 MCP`：读取当前 group path 下真实存在的 MCP 配置文件，展示本地 MCP entries，并允许把本地未管理 MCP 迁移到 McpHub。
- `McpHub MCP`：展示全局 McpHub 中心库中的 server，允许把 server 应用到当前 group path 的支持工具，或者取消已接管/已应用的 server。

McpHub 中心库只保存规范化核心 MCP server。MVP 支持 `stdio` 和 `http` 两种 transport；支持的目标工具是现有 `ToolId` 里的 `claude`、`codex` 和 `opencode`。不额外引入独立 MCP target id，不支持的工具不在项目 MCP 面板里显示。

分发时按当前 group path 写项目级配置：

- `claude` 写 `<groupPath>/.mcp.json` 的 `mcpServers`。
- `codex` 写 `<groupPath>/.codex/config.toml` 的 `mcp_servers`。
- `opencode` 写 `<groupPath>/opencode.json` 的 `mcp`。

写入采用结构化编辑：读取已有文件，解析为 JSON/TOML/JSON5 结构，更新或删除指定 server entry，再序列化写回。其它 server 和其它根字段保留；不做字节级格式保留，也不做复杂 diff preview。同名 entry 在应用时由 McpHub 的规范化配置覆盖。

McpHub 必须记录自己接管或写入过的项目 MCP entry。项目 binding 记录至少包含 `projectId`、`targetRootPath`、`toolId`、`serverId`、`appliedServerId` 和 `appliedAt`。取消启用、删除中心 server 或清理项目绑定时，只删除有接管记录的 entry；没有记录的本地 MCP 只在 `本地 MCP` 中展示，不会被 McpHub MCP 列表误删。

导入和编辑采用 JSON-only 流程。用户可以粘贴单个或多个 MCP server，也可以粘贴 Claude、VS Code/Copilot、OpenCode 等常见 JSON 形态。后端对粘贴内容做宽松解析和修复，提取关键信息后保存为规范化核心模型，不保留原始格式。导入同名完整定义时更新中心 server；导入同名不完整片段时 patch 已有 server；如果片段不完整且中心库中没有同名 server，则导入失败。

MVP 不保存真实 secret，不写系统或用户级环境变量。用户自行在系统、shell、IDE 或工具启动环境里设置 secret；McpHub 只保存变量名和引用。`requiredEnv` 缺失时只警告，不阻止应用，因为桌面应用进程环境不一定等于 Claude/Codex/OpenCode 的启动环境。

内置 MCP 控制在少量明确有用的 MCP server，并在 McpHub 中心库中直接生效，不需要用户先点击加入 Hub：

- `context7`：`stdio`，默认不带 token，提示可选环境变量 `CONTEXT7_API_KEY`。
- `playwright`：`stdio`，本地浏览器自动化，不需要 token。
- `unityMCP`：`http`，默认 URL 为 `http://127.0.0.1:8082/mcp`，要求用户自行启动本机 Unity MCP bridge。

## User Stories

1. As a local AI tool user, I want a top-level `McpHub` entry, so that I can manage MCP server definitions from one central library.
2. As a local AI tool user, I want McpHub to be independent from projects, so that the center library does not mix global server definitions with project-specific bindings.
3. As a local AI tool user, I want McpHub to store normalized MCP server definitions, so that one server can be distributed to Claude Code, Codex, and OpenCode.
4. As a local AI tool user, I want JSON-only MCP import and editing, so that I can paste examples from MCP documentation without filling many form fields.
5. As a local AI tool user, I want pasted JSON to accept common MCP shapes, so that Claude-style, VS Code/Copilot-style, OpenCode-style, and plain server maps can all be imported.
6. As a local AI tool user, I want pasted JSON to tolerate small bracket and formatting mistakes, so that copying partial snippets does not force manual cleanup every time.
7. As a local AI tool user, I want importing multiple MCP servers at once, so that a full `.mcp.json` can be absorbed in one action.
8. As a local AI tool user, I want import results to show added, updated, patched, and failed entries, so that I understand what changed.
9. As a local AI tool user, I want same-name complete imports to update existing servers, so that re-importing newer examples is simple.
10. As a local AI tool user, I want same-name incomplete imports to patch existing servers, so that small updates do not accidentally erase command, args, env, or URL fields.
11. As a local AI tool user, I want incomplete imports without an existing server to fail clearly, so that McpHub never creates unusable server definitions.
12. As a local AI tool user, I want `serverId` to be globally unique and stable, so that the final key written into each tool configuration is predictable.
13. As a local AI tool user, I want existing `serverId` values to be immutable, so that project bindings do not lose track of old entries after a rename.
14. As a local AI tool user, I want built-in MCP servers for `context7`, `playwright`, and `unityMCP` to be active in McpHub by default, so that common MCP servers are immediately available.
15. As a local AI tool user, I want McpHub to avoid real secret storage, so that tokens are not silently written into the app database.
16. As a local AI tool user, I want McpHub to show required environment variable names, so that I know what I need to configure outside the app.
17. As a local AI tool user, I want missing required env values to warn but not block writing, so that different tool launch environments are still supported.
18. As a local AI tool user, I want every project root and subproject group to have an `MCP` entry, so that I can manage MCP for the exact working directory shown in project detail.
19. As a local AI tool user, I want the project `MCP` panel to have `本地 MCP` and `McpHub MCP` tabs, so that local discovery and center-library application are not mixed.
20. As a local AI tool user, I want `本地 MCP` to read `.mcp.json`, `.codex/config.toml`, and `opencode.json`, so that I can see what the current directory actually exposes to tools.
21. As a local AI tool user, I want `本地 MCP` to show unmanaged entries without editing them, so that McpHub does not become a general local config editor.
22. As a local AI tool user, I want to migrate unmanaged local MCP entries into McpHub, so that existing hand-written project config can be brought under central management.
23. As a local AI tool user, I want local MCP migration to normalize the entry rather than preserve original format, so that future distribution uses one core model.
24. As a local AI tool user, I want migration to group same `serverId` across multiple target files, so that one local server can become one McpHub server with multiple bindings.
25. As a local AI tool user, I want migration to fail when same-name target configs differ, so that one target's data does not silently replace another.
26. As a local AI tool user, I want migration to mark existing files as McpHub-managed without immediately rewriting them, so that a working local config is not changed unnecessarily.
27. As a local AI tool user, I want `McpHub MCP` to show only center-library servers, so that unmanaged local entries are not confused with managed ones.
28. As a local AI tool user, I want applying a server to `claude` to write the current group `.mcp.json`, so that Claude Code can read project-level MCP config.
29. As a local AI tool user, I want applying a server to `codex` to write the current group `.codex/config.toml`, so that Codex can read project-level MCP config.
30. As a local AI tool user, I want applying a server to `opencode` to write the current group `opencode.json`, so that OpenCode can read project-level MCP config.
31. As a local AI tool user, I want `${PROJECT_ROOT}` to expand to the current project or subproject group path, so that built-in and reusable configs work across directories.
32. As a local AI tool user, I want disabling a managed server to delete only the matching managed entry from the current target config, so that unrelated local config is preserved.
33. As a local AI tool user, I want deleting a center server to clean only entries McpHub previously managed, so that unmanaged local MCP is not removed.
34. As a local AI tool user, I want unsupported tools to be hidden from the project MCP panel, so that I only see targets McpHub can actually write.
35. As a developer of the manager, I want McpHub to follow SkillHub's center-library plus project-panel model, so that users do not need to learn a separate product shape.
36. As a developer of the manager, I want MCP format conversion isolated per tool, so that target-specific config differences do not leak into the center model.
37. As a developer of the manager, I want structure-aware file writes, so that MCP entries can be updated without rewriting unrelated tool settings.
38. As a developer of the manager, I want external behavior tests around import, migration, application, and deletion, so that the feature is verified through user-visible flows.

## Implementation Decisions

- McpHub is an app-owned module and does not depend on `cc-switch`, `agents`, or any external MCP manager as runtime.
- Top-level `McpHub` manages only the center MCP server library.
- Project-level MCP management lives on each existing root/subproject project detail group and uses that group's full path as the target root.
- The project MCP panel has two tabs: `本地 MCP` and `McpHub MCP`.
- `本地 MCP` discovers existing local MCP entries and supports migration into McpHub, but does not edit or delete unmanaged local config.
- `McpHub MCP` shows only center-library server definitions and the current group bindings.
- The center library stores normalized server definitions, not Claude/Codex/OpenCode raw formats.
- MVP supports only `stdio` and `http`; `sse` is out of scope.
- MVP supports only `claude`, `codex`, and `opencode`; unsupported tools are hidden from project MCP management.
- The implementation uses existing `ToolId` values rather than adding a separate MCP target id type in MVP.
- `serverId` is globally unique and immutable after creation.
- The persisted binding identity includes the parent project, target group path, tool id, server id, last applied server id, and applied timestamp.
- McpHub deletes only entries for which it has an applied/managed record.
- Applying to Claude Code writes project-level `.mcp.json` with a top-level `mcpServers` map.
- Applying to Codex writes project-level `.codex/config.toml` with `mcp_servers`.
- Applying to OpenCode writes project-level `opencode.json` with `mcp`, converting `stdio` to local and `http` to remote.
- File writes are structure-aware: JSON/TOML/JSON5 is parsed, the specific MCP entry is changed, and the file is serialized back.
- The app does not promise byte-for-byte formatting preservation.
- The app does not provide a full diff preview before writing.
- Import and edit are JSON-only. There is no structured field form in MVP.
- JSON import attempts standard parsing first, then a safe repair pass for code fences, surrounding prose, comments, trailing commas, and small bracket imbalance.
- Import extracts known core fields from common input shapes: `mcpServers`, `servers`, `mcp`, plain server maps, and single server objects.
- Import normalizes OpenCode `local` entries to `stdio` and OpenCode `remote` entries to `http`.
- Unknown or unsupported fields are not treated as raw per-tool payloads to preserve.
- Same-name complete imports update the existing center server.
- Same-name incomplete imports patch existing known fields without deleting fields that were absent from the incoming snippet.
- Incomplete imports without an existing server fail validation.
- Local migration groups entries by `serverId` across supported target files.
- Local migration succeeds only when same-name normalized entries across targets are equivalent.
- Local migration records center library data, current group bindings, and applied ownership without immediately rewriting project files.
- McpHub does not store real secrets and does not write system or user-level environment variables.
- `requiredEnv` records variable names that users must configure outside the app.
- Missing required env values produce warnings rather than hard failures.
- Built-in MCP servers are `context7`, `playwright`, and `unityMCP`; they are seeded into the center library automatically and cannot be deleted as normal user-imported servers.

## Testing Decisions

- Tests should verify external behavior at storage, API, file-renderer, and UI seams rather than implementation internals.
- Storage tests should cover center MCP servers, immutable server ids, project group bindings, applied ownership records, and cascade/cleanup behavior.
- Import tests should cover multiple JSON shapes, repaired snippets, multiple server imports, complete update, patch update, incomplete failure, and unsupported transport failure.
- Renderer tests should cover Claude `.mcp.json`, Codex `.codex/config.toml`, and OpenCode `opencode.json` output while preserving unrelated config fields.
- Local discovery tests should cover reading existing Claude, Codex, and OpenCode project config files and normalizing their entries.
- Migration tests should cover single target migration, multi-target identical migration, multi-target conflicting migration, and migration without immediate file rewrite.
- API tests should cover listing McpHub with built-in MCP, importing JSON, listing project local MCP, migrating local entries, applying bindings, disabling bindings, and deleting managed entries.
- UI tests should cover top-level McpHub navigation, JSON import results, project group `MCP` button visibility, `本地 MCP` migration, and `McpHub MCP` apply/disable behavior.
- File write tests should use temporary project directories so no real MCP config is mutated.

## Out of Scope

- Team-shared MCP configuration.
- Runtime dependency on `cc-switch`, `agents`, or another MCP sync tool.
- Global user-level MCP sync.
- Writing system, user, shell, or tool settings environment variables.
- Secret vault or encrypted secret storage.
- Structured MCP edit forms.
- Full marketplace or remote source management.
- Background sync or global one-click sync across every project.
- Bidirectional synchronization from project files into McpHub after initial import or migration.
- Byte-for-byte formatting preservation of JSON, JSON5, or TOML files.
- Full diff preview before applying.
- `sse` transport.
- Copilot CLI, VS Code Copilot, Qwen, Qoder, Cursor, Gemini, Claude Desktop, or other targets in MVP.
- `filesystem` and `fetch` built-in MCP servers.
- Editing or deleting unmanaged local MCP entries from the `本地 MCP` tab.
- Renaming existing `serverId` values.
- Automatic workspace/package discovery beyond existing project detail groups.

## Further Notes

The reference implementation in `cc-switch` supports the same high-level pattern that McpHub should use: a central MCP server store, per-tool renderers, and import that reads existing config without immediately writing it back. McpHub intentionally adapts that pattern to this repository's project/subproject model rather than copying `cc-switch`'s user-level config behavior.

McpHub should remain symmetrical with SkillHub at the product level: a top-level center library and a project-context management panel. The difference is that skills are linked as directories, while MCP is applied by structure-aware edits to tool configuration files.
