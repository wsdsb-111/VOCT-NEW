# V9.3.6 验证报告

状态：本地候选验收，2026-10-16。基线 `03dfc4efe2791b31f28f4a4d521d41a10b59f6b9`。不得将本文件的自动化记录解释成 Full Freeze。

## Gate 0

开工时干净工作区；285 映射与部署 payload `41acdd5896978b94a6d198fec45ef0052fd05eabfcbe34cd38f309ccd9d2a9a4` 一致。基线 manifest 为 407 发布组／127 历史项／535 个测试文件。

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

本地 Gate 5 完整干净副本回归与回滚演练待最后收口；真实 CK3／Provider 账单／80–100 轮 Soak 为 NOT_RUN；远端 CI 为 PENDING_USER_PUSH，不推送。

## Gate 1：路由与保存回归

`test-v9.3.6-pair-memory-routing.js` 14 项行为断言通过，覆盖参与者重排、NPC 最近发言、可信当前玩家轮次、L0／L1／L2、引用、否定、同名歧义及有限追问。`test-v9.3.5-independent-qa.js` 原有 8 项均通过，包括迟到／耳语／混合可见性／缺席、NPC 双向定向保存、同日来源／Forget／同 stat 等长改写、150 摘要／750 事项 Golden Set 和共享预算。旧测试仅将与新合同冲突的“最近 NPC 改固定关系”改为玩家锚点断言，未归档安全用例。Gate 1 已完成；尚未据此宣称冻结事项、统一门禁或预算阶段完成。

## Gate 2／3：固定前缀、检索与隔离

独立 QA 在真实 MemoryEngine／MemoryStore／PairLedger／PromptBuilder 上执行，FR01–18、TP01–26、MP01–08 共 52 条目录用例覆盖；额外包含精确去重、合并多人投影及预算边界反例。默认脚本目前执行 68 个行为检查，不将仅列出的 TK 夹具冒充通过。独立 QA 自己的 TK01–08 目录仍为 NOT_RUN；下节由专门预算／集成测试提供交叉证据。

通过范围包括 30／100 条全量、500 条整条确定性裁剪及磁盘保留、15 轮字节稳定、Owner／Campaign／玩家隔离、Forget 撤回 Engine 与 prefix、同 stat 等长改写、来源删除、Official 与 Recent 不重复、多人视角和 NPC→NPC 保存。L0 额外 C 索引／原文读取为零；L1 每目标 ≤16 且零原文；L2 总来源 ≤2，包含双时间轴、损坏索引、来源过期和有界合法回退。

独立审查还实际复现了同正文多人投影合并时 L0 误读 B→C 的路径。修复后的新增反例强制来源顺序 C→A，C 的 read／resolve 均为 0，仍可使用合法 A 来源。Recent 同 key＋revision 精确引用、异 revision／近似文本不误删均通过。

## Gate 4：预算与发送

专项目录：`test-v9.3.6-prompt-budget.js`、`conversation-budget`、`provider-memory-budget`、`continuation-memory-guard`、`token-comparison`、`memory-diagnostics`（均在 scripts，完整名称带 test-v9.3.6 前缀）。使用确定性 Provider 替身，真实 API 调用数为 0。

| 规格 | 交叉验证 |
|---|---|
| TK01／02 | 真实 Conversation 8K/2人、16K/3人 dry-run／公式／Provider 余量；额外 Engine→真实 Prompt 三布局 64/256/1310/4800 边界，Recent 不清空 |
| TK03／04 | 32K／128K、4+ 人硬限 6400；中途人数增加不静默上调 |
| TK05／06 | 高输出预留缩减预算；Worldline／当前事实保留；实际发送前总请求超窗阻断，不产生第二次 transport |
| TK07 | 标题、日期、证据、角色消息开销纳入；三布局实际 block span／fingerprint 经 LLMManager 守卫各合法发送一次 |
| TK08 | 16 条事项＋两篇完整来源共享一个预算；整篇过大来源明确省略，不部分注入 |

新增真实续写链反例：初始截断后 Forget 阻止第二次实际传输；合法续写重跑同一来源 guard，partial 增大导致超窗也在发送前拒绝。诊断实际落盘再回读，计数／枚举／哈希保留，正文／路径／凭据哨兵不落盘，未知缓存不补零。旧生产 QA 仅升级可信轮次、L2 目标与完整原文预算合同，Scope／Future／Campaign／Forget／回滚断言保持。

## 隔离打包窗口

真实 `VOTC.exe`，独立空白 profile，清除凭据环境并阻止外网与 Provider。App／窗口标题／页脚为 9.3.6；实际 Main 加载模块与源／部署 SHA 一致，Legacy dashboard IPC 正常，Memory4 globals／IPC 均为空。打包 Engine 的 L0/L1/L2 来源数为 0／0／2，固定字节不变，1410／4800 估算 Token。退出后窗口进程关闭。此为合成打包验证，非 CK3／API／Soak。

## 最终本地候选

当前源码、构建与部署为 288 映射；候选 payload `aac8a3d73179cea343423abeb0fd954bbf6314f7c394fc5784c5118f2650bcb2`。最终干净副本六步和回滚结果待下方实际证据收口。清单目前为 417 发布组／127 历史项／545 测试文件。无推送，无用户数据修改或真实 Provider 费用。
