# Domain Docs

本文件定义工程技能在探索代码库时，应该如何读取本仓库的领域文档。

## 开始探索前优先读取

- 根目录下的 **`CONTEXT.md`**，或者
- 如果根目录存在 **`CONTEXT-MAP.md`**，先读它，再按它的指引读取与当前问题相关的 `CONTEXT.md`
- **`docs/adr/`** 中和当前改动区域有关的 ADR；如果是 multi-context 仓库，也要检查 `src/<context>/docs/adr/` 下的上下文专属决策文档

如果这些文件目前不存在，就直接继续，不要专门提示缺失，也不要先建议创建。像 `/grill-with-docs` 这类生产文档的技能会在需要时再补。

## 文件结构

当前仓库按 single-context 处理。典型结构如下：

```text
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

如果未来演进为 multi-context，通常会变成：

```text
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← 全局决策
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← 上下文专属决策
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## 使用词汇表中的术语

当技能输出领域概念时，例如 issue 标题、重构建议、问题假设、测试名称，优先使用 `CONTEXT.md` 中定义过的术语，不要随意改成近义词。

如果你需要的概念不在词汇表中，这通常意味着两种情况之一：要么你用了项目里并不存在的语言，需要重新判断；要么领域文档确实缺了一块，应在后续文档整理中补上。

## 输出语言

当技能生成文档类内容时，描述性说明默认使用中文。

以下内容应保留原文或精确标识，不要为了中文化而改写：

- 代码标识符
- 文件路径
- 命令
- 标签名、状态名和其他会被程序读取的字符串
- 外部系统中已经确定的专有名词

## 显式标出 ADR 冲突

如果某个建议和已有 ADR 冲突，应该明确指出，而不是静默覆盖。例如：

> _与 ADR-0007（event-sourced orders）冲突，但因为以下原因值得重新讨论……_
