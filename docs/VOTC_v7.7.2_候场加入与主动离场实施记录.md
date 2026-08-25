# VOTC v7.7.2：候场加入与主动离场实施记录

## 目标

V7.7.2 在 Memory Engine 2.3 上增加会话级人物在场窗口。多人会话不再假设所有已选择角色从头到尾始终在场：当前主要对话对象默认在场，其余人物在首句前候场；玩家可以请候场角色入内，也可以请当前角色离场。每个人只回应、获知并保存自己实际在场时听见的内容。

本次保留 V7.7.1 的人物目录、`owner × counterpart` 投影、冻结召回和终局恢复格式，不引入新的 Memory Engine 主版本或摘要迁移。

## 实际交互

1. CK3 当前主要对话对象开场默认在场，其余已选择 NPC 直接列为候场。
2. 日志解析完成后立即显示“选择入场人物”；第一条玩家消息发送前即可点击候场人物的“请入内”。
3. 候场人物显示“请入内”。点击后插入 `【人物入内】`，该人物从下一轮开始参与回应；加入当轮不会插队补一句。
4. 对话开始后，在场人物显示“请离场”。点击后插入 `【人物离场】`、关闭该人物的半开窗口，并立即把原始历史和窗口状态写入可恢复快照；不会单独调用一次离场摘要模型。
5. 已离场人物显示“已离场”，本场不能再次加入；最后一名在场 NPC 的离场按钮禁用。

UI 只在多人会话显示人物在场面板。流式回复、NPC 队列执行、暂停状态或动作处理尚未空闲时，人物切换暂时禁用，避免中途修改正在使用的回应者快照。

## 数据边界

每次实际参与使用半开区间：

```text
[joinedAtMessageId, leftAtMessageId)
```

- 初始在场人物在第一条玩家消息进入时打开窗口。
- 入内人物以 `presence_join` 系统消息为左边界。
- 离场人物以 `presence_leave` 系统消息为右边界，因此离场标记本身和之后的正文不属于其可见历史。
- 从未入内的候场人物没有窗口，不进入最终参与者列表，也不生成本场人物目录摘要。
- 动作脚本使人物自然离席时，仍会关闭相同的窗口，避免动作系统与 UI 离场形成两套生命周期。

终局仍只请求一次结构化摘要。Extractor 要求每条事件返回精确 `messageIds`；Knowledge Service 只把同时处在对应窗口内的事件写入角色 `knownBy`；Perspective Projector 再要求 owner 与 counterpart 的窗口对引用消息存在重叠。三个层次共同阻止：

- 候场者获知入内前的秘密；
- 离场者保存离场后的对话；
- 三人散场后把只与第三人的内容串入另一条配对文件。

## 提示词与缓存

稳定人物资料、长期记忆和冻结召回保持在历史之前。当前在场名单与本轮有效关系放在历史之后、当前用户消息之前，并标记为 `presence_roster` 动态区块。人物进出只改变动态后缀，不改变 history 前稳定区块的聚合指纹。

每名 NPC 的提示词历史由自己的窗口裁切；候场和已离场人物不进入当前回应列表。迟到者不复用包含其入场前内容的共享 rolling summary。

## 实机摘要空响应收口

实机记录显示，一场三人单轮对话产生了两次 `final_summary` Token 消耗，却没有任何人物目录文件。恢复快照完整保留了玩家、两名 NPC、四条原始消息和三人的在场窗口，失败阶段是 `request`，错误为 `invalid_final_summary_response`。两次 DeepSeek 请求都把 4096 输出预算耗在隐藏思考上，没有返回可解析的 JSON 正文，因此持久化层按设计拒绝提交。

普通角色对话继续开启 DeepSeek 思考模式。实机证明结构化摘要的隐藏推理即使扩大预算仍可能耗尽正文，因此 `final_summary`、失败重试与 `memory_recovery` 统一使用 4096 Token 非思考请求。已有待恢复快照不会删除，会在后续会话初始化时按同一终局 ID 自动重试；只有 JSON 解析、六份三人有向投影和全部人物目录文件校验都成功后才提交。

终局提示词要求把完整叙事写入携带确切来源消息 ID 的 `summarySegments`，应用本地拼成 `sessionSummary`。详细正文不在 JSON 中重复输出，长期记忆只作为召回索引，从而把 4096 Token 优先留给叙事细节。摘要与单条记忆均不设置固定字数或段落数量；缺少分段、正文为空或分段缺少有效来源消息时会被拒绝并自动修复重试。摘要按实际发生顺序逐人归属言行、观点和情绪，并保留地点、数字、物件、头衔、承诺条件、秘密计划、关系转折和未决事项。重复闲聊和低价值细节可以归并，但不得使用“双方讨论了某事”等泛化句替代具体事实。

## 代码范围

- `resources/app/out/main/action-system/conversation.js`：人物状态、入内/离场、逐人物历史和摘要参与者。
- `resources/app/out/main/memory-system/knowledge-service.js`：按消息引用和在场窗口计算 `knownBy`。
- `resources/app/out/main/memory-system/perspective-projector.js`：配对投影增加共同在场窗口校验。
- `resources/app/out/main/memory-system/memory-extractor.js`、`memory-engine.js`：抽取契约、终局和恢复快照携带人物窗口与进出事件。
- `resources/app/out/main/main.js`、`ipc/register-ipc.js`、`preload/preload.js`：在场状态及两条操作通道。
- `resources/app/out/renderer/assets/index-Dn3qWlAB.js`、`index-WtJH_nua.css`：聊天面板人物名单和三套主题通用按钮样式。

V7.7 原有 92 条 IPC 保持不变，V7.7.2 新增 `conversation:joinWaitingCharacter` 和 `conversation:leavePresentCharacter`，总计 94 条。

## 自动验证

- `scripts/test-v7.7.2-staged-presence.js`：主要对象默认在场、其余人物首句前候场、初始化状态即时推送、入内不插队、离场即时快照、最后一名在场 NPC 拒绝、终局单次摘要请求、三人单轮生成 3 个目录和 6 个有向文件、离场后历史隔离、动作离席、`knownBy`、配对投影、2–6 人、缓存指纹、忙碌态和 UI/IPC 合同。
- `scripts/test-v7.7.1-memory-engine-2.3.js`：既有知情与主题投影、结构化终局及召回合同不回退。
- `scripts/test-v7.6.1-directed-summary-persistence.js`：2–12 人仍生成完整 `N × (N−1)` 有向人物目录文件。
- `scripts/test-action-system.js` 与 `scripts/test-v7.2-action-memory-integration.js`：动作语义和 CK3 人物绑定不回退。
- `scripts/test-release.js`：统一发布门禁 35 组。

自动测试不能替代真实 CK3/UI/Provider 冒烟。发布前应在实机完成：至少三人开场、一人候场后入内、一人对话中离场、离场后继续密谈、结束会话，随后检查每个人物目录和配对文件的正文边界。
