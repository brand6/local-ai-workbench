# Triage Labels

这些技能内部使用五个标准分诊角色。本文件用于把这些角色映射到当前仓库实际使用的状态字符串。

| mattpocock/skills 中的标签 | 本仓库中的标签 | 含义 |
| -------------------------- | -------------- | ---- |
| `needs-triage`             | `needs-triage` | 需要维护者先判断和分诊 |
| `needs-info`               | `needs-info`   | 正在等待提单人补充信息 |
| `ready-for-agent`          | `ready-for-agent` | 信息已完整，可由 AFK agent 直接接手 |
| `ready-for-human`          | `ready-for-human` | 需要人工实现 |
| `wontfix`                  | `wontfix`      | 不会处理 |

当某个 skill 提到某个分诊角色时，例如“应用 AFK-ready 分诊标签”，应使用表格右侧这一列中的实际状态字符串。

如果以后你改了自己的状态命名，只需要更新本文件右侧这一列。
