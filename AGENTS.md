## Agent skills

### Issue tracker

本仓库的 Issues 和 PRD 使用 `.scratch/` 下的本地 Markdown 文件管理。详见 `docs/agents/issue-tracker.md`。

### Triage labels

使用默认的五个分诊状态标识：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。详见 `docs/agents/triage-labels.md`。

### Domain docs

本仓库按 single-context 配置。相关技能在这些文件存在时，应优先查看根目录的 `CONTEXT.md` 和 `docs/adr/`。详见 `docs/agents/domain.md`。

### Output language

生成文档时，描述性内容默认使用中文；代码标识、路径、命令、状态名和其他需要精确保留的技术标识维持原文。
