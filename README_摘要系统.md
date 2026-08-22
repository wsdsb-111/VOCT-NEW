# 对话摘要系统：Memory Engine 2.2（V7.3）

V7.3 以人物摘要文件夹作为唯一可见、可搜索、可编辑的长期记忆层，并用 CK3 数字 ID 将本名归档、动态称谓和死亡生命周期统一起来。结构化 Memory、Episode、Knowledge 与 Pair Index 仍在内部维护恢复能力和角色知情边界，但不再与人物摘要目录重复显示。

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

## 人物身份与动态称谓

- 数字角色 ID 是唯一身份主键。目录固定使用 `ID_本名`，对话文件固定使用 `与本名的对话.json`；头衔变化不会产生新的角色身份。
- `firstName` 优先作为存储本名；当前 `fullName`、主要头衔、称号、宫廷职位可以写入摘要正文和参与者元数据，但不进入目录名或文件名。
- 人名、完整称号、主要头衔、绰号和官职都可作为提及别名。`陛下`、`皇帝`、`殿下`等派生称谓只绑定当前资料或该目录中最近观察到的唯一持有人。
- 同一别名对应多人、最近观察日期并列或无法确定人物 ID 时失败关闭，不向任何人物注入猜测得到的记忆。
- 场外人物不在当前 CK3 场景资料中时，可以使用回应者本人目录内保存的参与者 ID 与称号完成解析；解析后仍只从回应者自己的目录召回该 ID 的摘要。

## 召回规则

每次 NPC 回应使用三条通道：直接关系 55%、被提及场外人物 30%、内部稳定记忆 15%。比例只应用于实际存在候选的通道；没有命中的通道不占预算，其额度按剩余通道权重回流。总预算为模型上下文约 8%，下限 800、上限 2400 token。

### A 与 B 直接对话

- A 回应时，只读取 A 自己目录中与 B 和当前话题相关的摘要。
- B 回应时，只读取 B 自己目录中与 A 和当前话题相关的摘要。
- A 的私人目录不会直接注入 B 的 Prompt，反之亦然。

### 对话中提到 C

- A 回应时，从 A 的目录检索 C 相关摘要。
- B 回应时，从 B 的目录检索 C 相关摘要。
- 相关性同时使用人物 ID、姓名、文件名、participants、摘要正文和当前问题。
- 玩家与任一 NPC 的发言都会被扫描。纯称号不会作为姓名命中；同一别名对应多个角色时不猜测；长名覆盖短名；会话只保存处理游标，不保留无限增长的消息 key 数组。

### 多人会话提到 E

ABCD 同时参与并提到 E 时，每个实际回应者分别按自己的目录执行检索。系统不设置参与者或提及人物数量硬上限；为避免 Prompt 无限膨胀，最终入选摘要仍受当前模型上下文的动态 token budget 约束。

信件与对话使用同一个 Engine 2.2 路由。收信人从自己目录读取与发信人的直接摘要，信件正文提到场外人物时，也从收信人自己的目录检索相关摘要。

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

- Final Summary 请求发出前即保存包含原始消息和参与者的 recovery snapshot；Provider 挂起或进程被强制结束后，下次启动仍可恢复。
- 退出程序最多等待终局队列 15 秒。超时会允许窗口退出，未完成任务依赖预请求快照恢复，不会无限卡住主进程。
- 人物目录写入必须返回明确成功；参与者不足、返回 `undefined` 或写盘失败都会保留恢复快照，不会把终局误报为成功。
- Provider 已返回成功内容后，磁盘重试不会再次请求模型。
- 恢复最多自动尝试三次，且 Memory、Episode 与人物目录写入均依赖稳定 ID 保持幂等。
- 内部 Knowledge Index 决定角色可访问哪些结构化秘密、承诺和事实；人物目录召回始终限定为当前回应角色自己的目录。
- 清理或迁移前请备份 `conversation_summaries`。UI 的“清除全部摘要”不可撤销。

## NPC 死亡生命周期

- `characterIsKilled` 实际写入 CK3 成功后，死亡 NPC 会退出会话并删除所有以其 ID 为目录拥有者的摘要文件夹，包括旧称号遗留的同 ID 文件夹。
- 其他人物目录中的 `与死者本名的对话.json` 不删除，它们表示生者对死者的回忆。
- 死亡发生在当前会话中时，终局摘要仍会写入生者拥有的方向，但跳过死者作为目录拥有者的方向；恢复快照保存这一排除集合，重启恢复也不会重新创建死者目录。

## 验证

从程序目录运行：

```powershell
node scripts\test-v7.1-memory-engine.js
node scripts\test-v7.2-memory-routing.js
node scripts\test-v7.2-sequential-finalization.js
node scripts\test-v7.2.1-stability.js
node scripts\test-v7.3-identity-lifecycle.js
node scripts\test-memory-ui.js
node scripts\test-release.js
node --check resources\app\out\main\main.js
```

自动回归不连接真实 CK3 或摘要 Provider。连续会话、多人长期游玩、Provider 挂起后重启恢复和动作实际写入 CK3 仍需实机验收；代码级 source/target 锁定、死亡目录清理和错误目标拒绝已纳入 V7.3 门禁。
