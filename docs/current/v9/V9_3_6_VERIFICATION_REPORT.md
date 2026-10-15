# V9.3.6 验证报告

状态：施工中，2026-10-15。基线 `03dfc4efe2791b31f28f4a4d521d41a10b59f6b9`。不得将本文件的阶段记录解释成 Full Freeze。

## Gate 0

开工时干净工作区；285 映射与部署 payload `41acdd5896978b94a6d198fec45ef0052fd05eabfcbe34cd38f309ccd9d2a9a4` 一致。当前 manifest 为 407 发布组／127 历史项／535 个测试文件。

首次完整重跑因主机 VOTC 仍有 4 个进程，按既有构建门禁停止。受限环境进程枚举曾显示 0，提升环境明确检测到 4；没有关闭检查旁路。用户确认退出后，在相同基线 payload 的隔离副本 `.build/v935-folder-clean-candidate-i2tFWS` 完整重跑，Node22.23.3，exit 0，407／407 组通过，日志 `.build/v936-baseline-clean-release.log`。该副本对应前轮快照 `f544bf7491ea3ed0dc16fd472134eba952ab75f0`；当前施工文件不影响其基线测试。

实际模块反例（`.build/v936-baseline-negative.js`，首次修改前观察，证据 `.build/v936-baseline-negative-evidence.json`）：

| 反例 | 修复前观察 | 判定 |
|---|---|---|
| L0 mentioned／entity_target | “丙刚刚到宫里”使乙→丙旧摘要进入动态块 | REPRODUCED |
| NPC 发言改变锚点 | 最近丙发言使乙的固定摘要改为乙→丙 | REPRODUCED |
| 40 条事项 | 预算 50000、真实索引 40 条，旧检索只返回 12 条 | REPRODUCED |
| Forget 后前缀副本 | 漏传持有缓存的会话时残留；传入活动会话时正常清除 | CONDITIONAL_REPRODUCED |
| Official 重叠字段 | 人为同时提供 separate Official 和包含同文的 direct 字段时重复；正常 Engine 不双重返回 | CONDITIONAL_ONLY |

修复前记录只保留首次实际观察；后续共享源码已变，不将再次运行的结果回写成基线。真实用户摘要、CK3 或 Provider 未用于该夹具。

## 待验收

Gate 1–5 待阶段代码与行为证据；真实 CK3／Provider 账单／80–100 轮 Soak 为 NOT_RUN；远端 CI 为 PENDING_USER_PUSH，不推送。

## Gate 1：路由与保存回归

`test-v9.3.6-pair-memory-routing.js` 14 项行为断言通过，覆盖参与者重排、NPC 最近发言、可信当前玩家轮次、L0／L1／L2、引用、否定、同名歧义及有限追问。`test-v9.3.5-independent-qa.js` 原有 8 项均通过，包括迟到／耳语／混合可见性／缺席、NPC 双向定向保存、同日来源／Forget／同 stat 等长改写、150 摘要／750 事项 Golden Set 和共享预算。旧测试仅将与新合同冲突的“最近 NPC 改固定关系”改为玩家锚点断言，未归档安全用例。Gate 1 已完成；尚未据此宣称冻结事项、统一门禁或预算阶段完成。
