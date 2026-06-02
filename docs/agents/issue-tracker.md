# Issue Tracker：本地 Markdown

本仓库的 Issue 和 PRD 以 Markdown 文件形式保存在 `.scratch/` 目录下。

## 约定

- 每个功能使用一个独立目录：`.scratch/<feature-slug>/`
- PRD 文件路径为：`.scratch/<feature-slug>/PRD.md`
- 实现类 issue 放在：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，编号从 `01` 开始
- 分诊状态记录在 issue 文件靠前位置的 `Status:` 行中，状态值定义见 `triage-labels.md`
- 评论和补充沟通记录追加在文件底部的 `## Comments` 标题下

## 当某个 skill 说“发布到 issue tracker”时

在 `.scratch/<feature-slug>/` 下创建对应文件；如果目录不存在，就先创建目录。

## 当某个 skill 说“获取相关 ticket”时

直接读取对应路径的文件。通常用户会直接提供文件路径，或者给出 issue 编号。
