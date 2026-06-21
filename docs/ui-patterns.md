# UI 模式沉淀

本文档记录本项目已经实现并被代码或测试覆盖的 UI 模式。它不是完整设计系统，也不提前规定尚未验证的组件规范；新增 UI 应先复用这里的稳定模式，只有业务语义确实不同才新增交互形态，并在对应 PRD、issue 或 ADR 中说明原因。

## 调研入口

实现或调整 UI 前，优先查看这些位置：

- `src/client/main.tsx`：应用级导航、Hub 加载、项目详情入口、全局反馈、对话框编排。
- `src/client/*Views.tsx`：各 Hub 和项目侧面板的具体列表、行、标签页、导入和操作区。
- `src/client/styles.css`：顶栏、toast、toolbar panel、dialog、Hub 行和项目 target 行的共享样式。
- `tests/ui.test.tsx`：用户可见行为的回归断言，是判断 UI 模式是否已经稳定的主要依据。
- `.scratch/<feature>/PRD.md` 与 `.scratch/<feature>/issues/*.md`：功能级 UI 约束、已接受的取舍和完成记录。

## 顶层导航

顶层 Hub 通过 sticky topbar 暴露入口，目前顺序由 UI 测试保护：`CliHub`、`PluginHub`、`SkillHub`、`AgentHub`、`McpHub`、`HookHub`。

顶栏同时承载三类上下文：

- 首页态：显示项目统计和全局项目操作。
- 项目详情态：显示当前 Project 名称，并把项目侧 Hub 入口放在对应 Project Group 操作区。
- Hub 态：保留全局 Hub 导航，当前 Hub 按钮高亮。

品牌 `AI项目管理` 右侧固定保留返回槽位；首页态只占位不显示按钮，项目详情态和 Hub 态在同一位置显示 `返回`，避免切换页面时顶栏按钮跳动。

新增顶层资源中心时，先判断它是否真的是 Hub；如果是，默认走同一 topbar 入口、同一 `AppView`/加载模型和同一 UI 测试断言，不在项目详情里另造全局入口。

## Hub 中心页

Hub 中心页用于管理 Center Library 或全局能力，不直接替代项目侧启用状态。常见结构：

- 页面标题使用 Hub 名称，例如 `SkillHub`、`AgentHub`、`McpHub`。
- 顶部操作使用 `toolbar-panel compact`，搜索、导入、创建、检查更新等能力按语义分区，不混在一个平铺区域。
- 资源按 Source、类别或业务分组展示；空分组不显示。
- 资源行优先使用 `details/summary` 的渐进披露：折叠态展示名称和少量关键状态，展开后展示描述、路径、工具目标和行内操作。
- 行内操作放在资源所在行内，例如打开文件、打开目录、删除、检查、更新；不要把只属于某一行的动作提升到面板头部。

Hub 之间能共享的行语义应复用现有组件或样式。已有示例包括 AgentHub 复用 SkillHub 的 source grouping 和 compact row；McpHub 项目行复用 SkillHub 的折叠行结构；PluginHub 内容区按 Skill、Agent、MCP、Hook 分类复用对应 Hub 的行/卡片语义。

## 项目侧面板

项目侧 Hub 面板服务于某个 Project Group，包括 Root Group 和 Subproject Group。面板只展示当前 group 可操作的 Project Target 状态，不承担全局库管理职责。

稳定模式：

- 项目详情中的每个 group 提供对应入口，例如 `技能`、`Agent`、`MCP`、`Hooks`、`Plugin`。
- 项目侧面板使用共享的右侧 `.side-panel` 加外部关闭层；点击面板外部关闭当前项目侧面板，面板内部行操作不应触发关闭。
- 面板内用标签页区分中心库资源和本地发现资源，例如 `SkillHub技能` / `本地技能`、`AgentHub Agent` / `本地 Agent`、`McpHub MCP` / `本地 MCP`。
- 中心库标签负责 Apply、Sync、Disable 等绑定操作；本地标签负责展示 unmanaged/managed 文件、迁移到中心库、取消或解释只读状态。
- 只显示当前项目启用且后端支持的 Tool target。工具可用性和可操作状态应来自共享 adapter/API 状态，不在单个面板里硬编码。
- 主行勾选和展开后的工具级勾选要保持语义一致；如果外观复用了 SkillHub，状态计算和后端保护也要一起复用。

项目侧面板不要静默改写 Center Library，也不要把 Plugin-owned、Hub-owned、Local-owned 等来源混为同一种本地资源。只读、迁移、同步和删除边界必须在 UI 中可见。

## 反馈与长操作

临时反馈统一进入 `GlobalNotice` 的底部全局 toast。现有模式：

- toast 容器使用 `aria-live="polite"`，toast 内容使用 `role="status"`。
- 同一时刻只显示一个主要浮动反馈；长操作状态优先级高于普通成功消息。
- 扫描、刷新、CliHub 操作、终端更新启动等短期状态走同一反馈面，而不是新增局部横幅或重复提示。
- 可持久追溯的信息留在资源行或结果区域，例如 CliHub 的最近 operation 输出、Preview/Impact 结果。

如果一个新操作会持续一段时间，应优先接入现有 busy/action 状态和 toast，而不是只禁用按钮或只在当前行显示临时文本。

## Preview、Impact 与确认

Writeback、Apply、Sync、Disable、删除、覆盖、迁移等风险操作需要在执行前展示用户能理解的影响范围。

既有约定：

- `Preview` 用于操作前确认，说明将写入、覆盖、删除或同步的目标。
- `Impact` 用于说明受影响的 Project、Project Target、Binding、Managed File 或 Center Library 资源。
- `Conflict`、`Drift`、`Unmanaged File` 不能当普通错误隐藏；需要给用户明确选择，例如覆盖、迁移后覆盖、跳过或取消。
- 覆盖、禁用、删除等写回前应走后端所有权和备份保护，UI 不能只做前端确认。

新增风险操作时，先查是否已有对应 preview/delete/apply/sync API 和 dialog 模式；没有时先补公共后端语义，再接 UI。

## 加载与刷新

顶层 Hub 首次进入默认采用 cached-first 模式：

- 先通过轻量列表 GET 展示已有缓存或持久化数据。
- 再通过显式 refresh/discovery route 做较重的发现、seed、更新检查或详情加载。
- 避免同一入口触发重复请求；切换页面后应忽略过期结果。
- 只有手动刷新、行级检查或明确需要详情时才走重路径。

当前共享入口是 `src/client/main.tsx` 的 `loadHub`。新增 Hub 或重做 Hub 性能时，先复用它，再考虑是否需要新策略。

项目详情页的筛选输入应本地响应并延迟提交查询。输入过程中保留当前详情列表，通过轻量状态提示说明筛选正在更新；新查询返回 summary 后再替换列表，避免每个按键清空页面或触发完整详情重渲染。

## 文案与可见信息

可见 UI 文案默认中文。代码标识、路径、命令、API 名、状态名、工具名等需要精确保留的技术标识维持原文。

用户给过的中文按钮或提示文案应尽量逐字保留。做 UI 美化时，优先改善结构、层级和密度，不顺手改业务逻辑或已接受文案。

折叠行应保持低噪声：折叠态只放名称、少量关键标签和必要操作；详细描述、路径、失败输出、目标工具、迁移说明放到展开内容或结果区。

## 测试要求

UI 变更至少补或更新用户可见行为测试。优先使用 `tests/ui.test.tsx` 覆盖：

- 顶栏入口是否存在且顺序稳定。
- Hub 页面是否打开、分组、搜索、导入、创建或刷新。
- 项目侧面板是否只展示当前 group 和可用 tool target。
- 行内操作是否调用对应 API，而不是误走另一个 Hub 的管理入口。
- toast、loading、cached-first、dialog、Preview/Impact、Conflict/Drift 分支是否可见。

如果 UI 变更触及后端所有权或写回语义，还需要补对应 API/service 测试，不能只依赖前端测试。

## 文档沉淀规则

功能专属 UI 约束先写入对应 `.scratch/<feature>/PRD.md` 和 issue。某个模式被两个以上功能复用，或会影响后续 agent 默认实现方式时，再沉淀到本文档。

当本文档和具体 PRD/issue 发生冲突时，以当前功能 PRD/issue 的明确验收标准为准，并在完成后决定是否反向更新本文档。
