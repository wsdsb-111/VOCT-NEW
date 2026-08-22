# 对话摘要系统：Memory Engine 2.1

V7.1 以人物摘要文件夹作为唯一可见、可搜索、可编辑的长期记忆层。结构化 Memory、Episode、Knowledge 与 Pair Index 仍在内部维护恢复能力和角色知情边界，但不再与人物摘要目录重复显示。

## 存储结构

```text
%APPDATA%/VOTC/votc_data/
├─ conversation_summaries/
│  ├─ 100_角色A/
│  │  ├─ 与角色B的对话.json
│  │  └─ 与角色C的对话.json
│  └─ 200_角色B/
│     └─ 与角色A的对话.json
├─ memory/
│  ├─ episodes/
│  ├─ characters/
│  ├─ pairs/
│  ├─ knowledge/
│  └─ index.json
└─ memory_recovery/
```

`conversation_summaries` 是玩家在 UI 中管理的正文；`memory` 是系统内部索引，不应手工混入人物摘要目录。

## 召回规则

### A 与 B 直接对话

- A 回应时，只读取 A 自己目录中与 B 和当前话题相关的摘要。
- B 回应时，只读取 B 自己目录中与 A 和当前话题相关的摘要。
- A 的私人目录不会直接注入 B 的 Prompt，反之亦然。

### 对话中提到 C

- A 回应时，从 A 的目录检索 C 相关摘要。
- B 回应时，从 B 的目录检索 C 相关摘要。
- 相关性同时使用人物 ID、姓名、文件名、participants、摘要正文和当前问题。

### 多人会话提到 E

ABCD 同时参与并提到 E 时，每个实际回应者分别按自己的目录执行检索。系统不设置参与者或提及人物数量硬上限；为避免 Prompt 无限膨胀，最终入选摘要仍受当前模型上下文的动态 token budget 约束。

## 会话结束写入

Memory Engine 以 participant presence 记录整场会话中实际出现过的人物。一场会话结束后，只发起一次最终摘要请求，并将结果写入所有参与者的有向配对文件。

例如 A、B、C 三人参与时会写入：

```text
A/与B的对话.json
B/与A的对话.json
A/与C的对话.json
C/与A的对话.json
B/与C的对话.json
C/与B的对话.json
```

每条记录包含稳定的 `finalizationId`。恢复重试不会重复追加；同一群聊在一个人物目录中出现多个配对镜像时，召回也会按该 ID 去重。

## 摘要管理 UI

摘要页只保留一套层级：

```text
角色A的人物摘要目录
└─ 与角色B的对话
   ├─ 摘要 1（可编辑/删除）
   └─ 摘要 2（可编辑/删除）
```

搜索姓名或 ID 时：

1. 该人物自己的目录排在最前；
2. 其次显示其他人与该人物的直接对话；
3. 最后显示 participants 或正文中涉及该人物的摘要。

玩家修改摘要时，系统使用原子文件替换；双向镜像优先按 `finalizationId` 更新同一记录，避免数组顺序不同导致改错摘要。

## 失败恢复与边界

- Final Summary 失败会保留 recovery snapshot；Provider 已返回成功内容后，磁盘重试不会再次请求模型。
- 恢复最多自动尝试三次，且 Memory、Episode 与人物目录写入均依赖稳定 ID 保持幂等。
- 内部 Knowledge Index 决定角色可访问哪些结构化秘密、承诺和事实；人物目录召回始终限定为当前回应角色自己的目录。
- 清理或迁移前请备份 `conversation_summaries`。UI 的“清除全部摘要”不可撤销。

## 验证

从程序目录运行：

```powershell
node scripts\test-v7.1-memory-engine.js
node scripts\test-memory-ui.js
node scripts\test-release.js
node --check resources\app\out\main\main.js
```

自动回归不连接真实 CK3 或摘要 Provider。50 次连续会话、多人长期游玩、Provider 断线恢复和真实 Action 绑定仍需实机验收。
