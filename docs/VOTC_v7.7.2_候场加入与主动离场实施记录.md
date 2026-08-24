# VOTC v7.7.2：候场加入与主动离场实施记录

## 目标

V7.7.2 在 Memory Engine 2.3 上增加会话级人物在场窗口。多人会话不再假设所有已选择角色从头到尾始终在场：玩家可以在首句前设置候场，在对话中请候场角色入内，也可以请当前角色离场。每个人只回应、获知并保存自己实际在场时听见的内容。

本次保留 V7.7.1 的人物目录、`owner × counterpart` 投影、冻结召回和终局恢复格式，不引入新的 Memory Engine 主版本或摘要迁移。

## 实际交互

1. CK3 当前选择的 NPC 开场默认全部在场，旧用法无需额外点击。
2. 第一条玩家消息发送前，在聊天面板可将任一非最后在场 NPC“设为候场”。
3. 候场人物显示“请入内”。点击后插入 `【人物入内】`，该人物从下一轮开始参与回应；加入当轮不会插队补一句。
4. 对话开始后，在场人物显示“请离场”。点击后插入 `【人物离场】` 并立即请求该人物的离场前摘要。
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

## 代码范围

- `resources/app/out/main/action-system/conversation.js`：人物状态、入内/离场、逐人物历史和摘要参与者。
- `resources/app/out/main/memory-system/knowledge-service.js`：按消息引用和在场窗口计算 `knownBy`。
- `resources/app/out/main/memory-system/perspective-projector.js`：配对投影增加共同在场窗口校验。
- `resources/app/out/main/memory-system/memory-extractor.js`、`memory-engine.js`：抽取契约、终局和恢复快照携带人物窗口与进出事件。
- `resources/app/out/main/main.js`、`ipc/register-ipc.js`、`preload/preload.js`：在场状态及两条操作通道。
- `resources/app/out/renderer/assets/index-Dn3qWlAB.js`、`index-WtJH_nua.css`：聊天面板人物名单和三套主题通用按钮样式。

V7.7 原有 92 条 IPC 保持不变，V7.7.2 新增 `conversation:joinWaitingCharacter` 和 `conversation:leavePresentCharacter`，总计 94 条。

## 自动验证

- `scripts/test-v7.7.2-staged-presence.js`：默认全员、首句前候场、入内不插队、离场即时摘要、离场后历史隔离、动作离席、`knownBy`、配对投影、2–6 人、缓存指纹和 UI/IPC 合同。
- `scripts/test-v7.7.1-memory-engine-2.3.js`：既有知情与主题投影、结构化终局及召回合同不回退。
- `scripts/test-v7.6.1-directed-summary-persistence.js`：2–12 人仍生成完整 `N × (N−1)` 有向人物目录文件。
- `scripts/test-action-system.js` 与 `scripts/test-v7.2-action-memory-integration.js`：动作语义和 CK3 人物绑定不回退。
- `scripts/test-release.js`：统一发布门禁 35 组。

自动测试不能替代真实 CK3/UI/Provider 冒烟。发布前应在实机完成：至少三人开场、一人候场后入内、一人对话中离场、离场后继续密谈、结束会话，随后检查每个人物目录和配对文件的正文边界。
