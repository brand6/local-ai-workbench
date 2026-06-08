# Github Repo Manager

本上下文描述本地 AI 项目与会话管理器中的核心产品概念和命名约定。它用于统一产品讨论、issue、测试和架构建议中的领域语言。

## Language

**Project**:
用户登记到应用中的本地工作目录，用于归集该目录及其可选子目录下的 AI 工具会话和项目级分发状态。
_Avoid_: Repository, workspace

**Relocation**:
用户在应用外移动 Project 目录后，应用将旧会话路径重新关联到新项目路径的流程；需要预览、备份和受控的会话 cwd 写回。
_Avoid_: Rename, full rewrite

**Writeback**:
应用在用户确认后把受控变更写回 Tool 原生文件或项目文件的动作；它应有预览、边界和可恢复点。
_Avoid_: Refresh, indexing, config save

**Preview**:
Writeback、Apply、Sync、Disable、删除或更新等风险操作执行前展示给用户确认的影响说明。
_Avoid_: Summary, list view

**Impact**:
某个操作会影响到的 Projects、Project Targets、Bindings、Managed Files 或 Center Library 资源范围。
_Avoid_: Diff, result

**Backup**:
Writeback、覆盖、删除或禁用等风险操作前创建的可恢复文件副本。
_Avoid_: Temp copy, cache

**Session**:
某个 AI 工具产生的一段可查看、可索引、并在条件满足时可恢复的交互历史。
_Avoid_: Chat, conversation

**Session Index**:
应用从各 Tool 的原始会话历史中建立的本地索引视图；它用于展示、分组、搜索和恢复判断，不拥有原始会话历史。
_Avoid_: Session store, history database

**Resume**:
通过 Tool 原生 session id 和历史工作目录继续已有 Session 的动作。
_Avoid_: Open project, start session

**Tool**:
应用支持或检测的本地 AI CLI 或编码工具，例如 Codex、Claude、OpenCode、Qwen、Cursor。
_Avoid_: Provider, integration

**Availability**:
Tool 或 CLI 在当前机器上是否可被检测并运行的用户可见状态。
_Avoid_: Support, installation

**Support**:
应用对某个 Tool 或 Hub 能力的产品支持边界，例如是否支持新建会话、扫描历史、Resume 或项目侧分发。
_Avoid_: Availability, installed state

**Capability**:
Tool、Hub 或 Project Target 当前支持的具体能力项，例如 launchNew、scanHistory、resume、Apply 或 Sync。
_Avoid_: Support, feature flag

**Operation**:
应用中需要向用户展示进度或结果的长耗时动作，例如 CliHub 的 install、update-check、update 或 discovery。
_Avoid_: Background task, job

**Channel**:
CliHub 中某个 CLI 可用的安装或更新路径，例如 npm、winget、choco、scoop、GitHub release 或本地安装命令。
_Avoid_: Provider, package manager

**Project Group**:
项目详情页中承载会话、项目侧 Hub 面板和 Project Target 的工作目录分组，包括根目录分组和 Subproject Group。
_Avoid_: Section, panel

**Project Candidate**:
扫描过程中发现但尚未由用户确认加入项目列表的本地目录。
_Avoid_: Discovered project, unconfirmed project

**Root Group**:
项目详情页中代表 Project 根目录本身的固定 Project Group。
_Avoid_: Main project, parent project

**Subproject Group**:
项目详情页中由会话工作目录推导出的子目录分组；它不是独立的顶层项目。
_Avoid_: Child project, nested project

**Hub**:
应用中的顶层资源中心，用于管理可复用资源或工具能力，并在项目侧按需分发或启用。
_Avoid_: Marketplace, store

**Center Library**:
Hub 在应用数据目录中拥有的真实资源库；项目侧只接收由它分发、链接、生成或启用的目标文件。
_Avoid_: Project library, target files

**Project Target**:
Hub 在某个 Project 的具体工具或目录下管理的项目侧落点，可以是链接、生成文件、配置项或启用记录。
_Avoid_: Installed copy, project library item

**Apply**:
用户将 Center Library 中的 Hub 资源分发或启用到某个 Project Target 的动作。
_Avoid_: Install, copy

**Sync**:
用户让已有 Binding 或 Project Target 跟上 Center Library 当前状态的动作。
_Avoid_: Apply, refresh

**Disable**:
用户取消某个 Binding，使项目侧不再暴露对应 Hub 资源的动作；它不删除 Center Library 中的资源。
_Avoid_: Delete, uninstall

**Managed File**:
应用写入项目目录并登记所有权的文件；后续可以基于该所有权进行状态检测、同步、禁用、备份或删除。
_Avoid_: Generated file, owned artifact

**Drift**:
Managed File 或 Project Target 的项目侧内容与应用上次记录或生成的内容不一致的状态。
_Avoid_: Dirty, changed

**Conflict**:
用户请求的操作遇到同名资源、同一路径、Drift、Unmanaged File 或其他所有权边界，需要用户明确选择处理方式的状态。
_Avoid_: Error, warning

**Unmanaged File**:
项目目录中可被应用识别但尚未登记为应用所有的文件；应用只能在用户明确迁移、覆盖或移除绑定后管理它。
_Avoid_: Local file, external file

**Migration**:
用户把已有 Unmanaged File 或外部本地资源纳入某个 Hub 的 Center Library 或 Binding 管理的流程。
_Avoid_: Import, copy

**Binding**:
应用记录的 Hub 资源与 Project Target 之间的关系；它描述某个中心资源如何作用到项目侧目标。
_Avoid_: File, resource copy

**Source**:
Hub 资源的导入来源或分组来源，例如本地目录、GitHub 仓库或内置包；除非某个 Hub 明确支持同步，它不代表运行时依赖。
_Avoid_: Runtime dependency, truth file

**Import**:
用户把外部资源复制、克隆或物化进 Hub 的 Center Library 的动作。
_Avoid_: Apply, migration

**Truth File**:
Center Library 中被应用拥有并视为某个 Hub 资源真实内容的文件；它不同于原始导入文件，也不同于项目侧生成文件。
_Avoid_: Source file, generated file

**Projection**:
应用从 Truth File 解析出的通用视图，用于列表、搜索、状态判断或跨工具转换；它不是新的真实内容来源。
_Avoid_: Canonical copy, normalized source
