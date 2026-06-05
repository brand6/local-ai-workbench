Status: ready-for-human

# wshobson/agents harness 调研初版

调研日期：2026-06-05

## 结论摘要

`wshobson/agents` 的多工具支持不是“把同一个 plugin 目录复制给所有工具”。它以 `plugins/` 为 source-of-truth，再通过各 harness adapter 生成工具原生 artifacts。

这对 PluginHub 的影响是：导入 source 时只应建立本地 source、plugin 索引和组件库；项目安装完整 plugin 时必须选择目标工具，并走目标工具 adapter。不能把 `plugins/<name>/` 当作所有工具通用的安装包。

## Source-of-truth

上游 source-of-truth：

- `plugins/<plugin-name>/`
- `plugins/<plugin-name>/.claude-plugin/plugin.json`
- `plugins/<plugin-name>/agents/*.md`
- `plugins/<plugin-name>/commands/*.md`
- `plugins/<plugin-name>/skills/<skill-name>/SKILL.md`

上游说明：`plugins/` 是 source-of-truth，generated artifacts 不应手改；需要通过 `make generate HARNESS=<tool>` 或 `make generate-all` 生成。

## Harness matrix

| Harness | 上游支持方式 | 关键路径 | PluginHub 含义 |
| --- | --- | --- | --- |
| Claude Code | source-of-truth 原生 marketplace/plugin | `.claude-plugin/marketplace.json`, `plugins/<name>/.claude-plugin/plugin.json`, `plugins/<name>/...` | 最接近 source plugin 原貌；PluginHub 可优先研究生成 Claude 原生 plugin 包或 marketplace catalog。 |
| Codex CLI | committed marketplace + per-plugin manifest；部分树按需生成 | `.agents/plugins/marketplace.json`, `plugins/*/.codex-plugin/plugin.json`, generated `.codex/skills/`, `.codex/agents/` | Codex 区分 marketplace source 和 plugin install；PluginHub 应作为本应用 marketplace 暴露给 Codex，而不是把每个 upstream source 都当项目 marketplace。 |
| Cursor | thin marketplace + curated rules；复用 Claude 结构 | `.cursor-plugin/`, `.cursor/rules/`, `.claude/` 相关结构 | Cursor adapter 不能只复制 SkillHub 目录；需要确认 Cursor 插件安装如何读取 `.claude/` agents/skills。 |
| OpenCode | clone 后 generate/install；无一键 URL install | generated `.opencode/agents/`, `.opencode/commands/`, `.opencode/skills/`, `opencode.json` | 需要本地 adapter 或调用上游 generator；private/native 文件冲突风险较高。 |
| Gemini CLI | extension manifest + generated extension-root trees | `gemini-extension.json`, generated `skills/`, `agents/`, `commands/` | 安装形态更像本地 extension；PluginHub 需要生成 extension root，而不是单组件 link。 |
| Copilot | adapter/generator 存在，但安装语义需要二次确认 | generated `.copilot/agents/`, `.copilot/skills/`, `.copilot/commands/` | 先作为 planned/experimental harness；实现前必须复核真实 Copilot Agent/skill 目录和 repo/global scope。 |

## Component transformations

上游 adapter 会做工具差异处理，PluginHub 不能假设 Markdown 原文件在所有工具下语义一致。

| Source pattern | Codex | Cursor | OpenCode | Gemini |
| --- | --- | --- | --- | --- |
| `agents/*.md` | 转为 `.codex/agents/<plugin>__<agent>.toml`；丢弃或映射部分 frontmatter；推断 `sandbox_mode` | 复用 Claude agents 结构 | 转为 `.opencode/agents/<plugin>__<agent>.md`，加 `mode: subagent` 和 `permission:` | 转为 `agents/<plugin>__<agent>.md` |
| `skills/*/SKILL.md` | 可从 source 读取，也可生成 `.codex/skills/<plugin>__<skill>/`；需处理 8 KB body cap | 通过 Claude-compatible 结构读取 | 转为 `.opencode/skills/<plugin>-<skill>/`，需安全命名 | 转为 extension-root `skills/<plugin>__<skill>/SKILL.md` |
| `commands/*.md` | 转为 skills 或等价调用材料 | 保留 slash command 语义 | 转为 `.opencode/commands/` | 转为 `commands/<plugin>/<command>.toml` |
| agent `tools:` | Codex 只保留粗粒度 sandbox 语义 | Cursor 不完整支持 | 转换为 OpenCode `permission:` | Gemini 可透传一部分 `tools:` |
| agent `model:` | 映射到 GPT-5 family | 通常改为 `inherit` | 映射到 provider/model-id | 映射到 `gemini-2.5-*` |

## Install semantics

### Claude Code

上游支持：

- `/plugin marketplace add wshobson/agents`
- `/plugin install <plugin-name>`

PluginHub 含义：

- 如果支持 Claude Code 原生 plugin 安装，PluginHub 应生成一个 marketplace/catalog，让 Claude 从 PluginHub 这一个市场安装 plugin。
- 导入 `wshobson/agents` 不等于直接给项目执行 `/plugin marketplace add wshobson/agents`。

### Codex CLI

上游支持：

- `npx codex-marketplace add wshobson/agents`
- 然后安装单个 plugin。
- committed `.agents/plugins/marketplace.json` 指向 `./plugins/<name>`。

PluginHub 含义：

- Codex 的 marketplace source 和 plugin install 是两层；项目 install 应从 PluginHub 生成的 marketplace/plugin catalog 安装。
- Codex skills 和 agents 有目标格式限制；不能把 Claude agent markdown 原样当 Codex agent。

### Cursor

上游支持：

- 通过 `.cursor-plugin/` 和 `.cursor/rules/` 暴露 thin marketplace 和规则。
- Cursor 复用 Claude-compatible agents/skills 结构，但能力有降级。

PluginHub 含义：

- Cursor adapter 需要验证 `.cursor-plugin` manifest 如何指向 source plugin。
- Cursor 对 per-agent tool allowlist 不完整，不能把 Claude `tools:` 语义当成完全等价。

### OpenCode

上游支持：

- clone repo 后 `make generate HARNESS=opencode`。
- `make install-opencode` 运行 generate 并 symlink `.opencode/` 到 OpenCode 配置目录。

PluginHub 含义：

- OpenCode 安装不是 marketplace add + install。
- PluginHub 需要本地生成 `.opencode` artifacts，或把 OpenCode 支持延后到专门 adapter。
- `tools:` 到 `permission:` 的转换是关键行为。

### Gemini CLI

上游支持：

- clone repo 后 `make generate HARNESS=gemini`。
- `gemini extensions install .`
- `gemini-extension.json` 指定 `contextFileName: AGENTS.md`。

PluginHub 含义：

- Gemini 安装像 extension root，不是按单个 component link。
- PluginHub 要么生成 extension root，要么先不承诺 Gemini native plugin 安装。

### Copilot

上游支持：

- 上游文档和 adapter tree 提到 Copilot generator。
- 生成路径包含 `.copilot/agents/`, `.copilot/skills/`, `.copilot/commands/`。

PluginHub 含义：

- Copilot 的 repo/global scope 和真实消费路径需要单独复核。
- 在 PluginHub MVP 中应标为 research/planned，不应和 Claude/Codex 同时承诺。

## PluginHub adapter 建议

1. `PluginHub` source import 阶段只做 source/plugin/component catalog，不生成项目工具 artifacts。
2. 项目完整 plugin 安装必须显式选择目标 tool/harness。
3. 每个目标工具需要一个 `PluginInstallAdapter`，输入统一 plugin graph，输出 preflight target paths 和 write plan。
4. `PluginInstallAdapter` 负责声明支持度：`native`, `component-only`, `unsupported`。
5. Claude Code 和 Codex 可以作为第一批 native adapter 研究对象。
6. OpenCode、Gemini、Copilot 先进入 compatibility matrix，不在 MVP 中默认可安装，除非实现 adapter 并通过 fixture 验证。
7. 对上游 generator 的使用需要单独决策：直接调用 `make generate` 会引入 Python/uv/Makefile 和上游脚本稳定性问题；本项目内实现最小 adapter 则需要承担格式映射维护成本。

## 参考链接

- README: https://github.com/wshobson/agents
- Harness matrix: https://github.com/wshobson/agents/blob/main/docs/harnesses.md
- Adapter architecture: https://github.com/wshobson/agents/blob/main/ARCHITECTURE.md
- Authoring portability rules: https://github.com/wshobson/agents/blob/main/docs/authoring.md
- Codex marketplace example: https://raw.githubusercontent.com/wshobson/agents/main/.agents/plugins/marketplace.json
- Gemini extension example: https://raw.githubusercontent.com/wshobson/agents/main/gemini-extension.json
