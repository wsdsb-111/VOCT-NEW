# V9.4.1 PromptPlan 与来源诊断修复

2026-10-21，施工基线 `e6bdc711dc2624e1447a44a49e0041882a274d2a`，分支 `codex/v9.4.1-prompt-plan-fixes`。依据用户提供的《VOCT V9.4.1 — PromptPlan & Cache 修复施工文档》实施同一个 V9.4.1；实际结果与未执行项见[验证记录](V9_4_1_VERIFICATION.md)。本版仍为候选。

## V813 静态分类

V813 旧提升点只设置公开 `lifecycle=GLOBAL_STATIC`，新分类器却先将未带可信语义的 `main_segment` 归为动态，导致两段安全规则排到历史之后。新增红测在原基线明确失败于 `main-system-stable_global: DYNAMIC_WORLDLINE != GLOBAL_STATIC`。

`prompt-builder.js` 在原有 V813 hoist 条件通过后，设置 `semanticKind=GLOBAL_STATIC` 并向进程内 WeakMap 登记该片段。仍仅允许 system 角色、`stable_global`／`stable_history_rp`、无其他动态变量、有效非空内容；只有既有的唯一 `{{fullName}}` 情形替换为 `【当前回应角色】`。原动态回应者身份补充不变。

分类器仅承认可信生产点的登记，不接受普通配置块自报语义。既有主模板分段路径同样登记其计算结果，system 之外的角色不升级为全局静态。普通 main／main_segment／description／examples／custom 即使填写 stable、lifecycle 或 semanticKind，也保持动态。内部 pending／committed 拆分通过独立计算的 kind，继续分别为 QUERY_DYNAMIC_MEMORY／RESPONDER_FROZEN。

旧公开四种 lifecycle 与七类 Plan kind 分开；`prompt_plan_v9_1`、cache anchor、block ID、legacy／shadow 消息不变。默认 V9 的受控顺序变化是将 V813 两段可信规则恢复到静态前缀。角色、正文集合、重复消息贡献、合法记忆和 Token 总量保持。

## 只读 provenance

保留现有 `permission.sourceRefs` 的匿名诊断身份，明确它们不能单独授权。Plan 的可选 `provenance` 只含 `evidenceLevel`、`sourceCount`、HMAC `diagnosticIds` 和说明字段 `authority=LEGACY_VERIFIER`。Plan Seal 覆盖新增数据，结构校验接受无该字段的旧 Plan；发送仍要求原 proofVerifier、beforeSendGuard、来源／Forget／知情和最终预算检查。

`dynamic-summary-freeze.projectPlanSource()` 只投影已入选来源，不读磁盘、不召回、不提交。来源真实 key、revision、Owner、Campaign、Conversation、Player 保存在投影对象和最终 Plan block 的 WeakMap sidecar；原始 key 不进入 Plan JSON、Serializer metadata、Provider payload、IPC 或诊断 JSONL。上下文浅复制保留投影成员；复制成员后绑定丢失时降 UNKNOWN，不按 key 文本反查充权。可通过主进程内部 `getPlanSourceBindings(plan, blockId)` 读取冻结的只读映射。

| 等级 | 本版实际使用范围 |
|---|---|
| SOURCE_BOUND | 既有 verified temporal／third-person 来源同时携带真实 sourceSummaryKey、sourceRevision，Owner／Campaign 与源对象一致；Plan 再核对当前 Owner／Responder／Campaign／Conversation／Player |
| SNAPSHOT_DERIVED | 仅四个实际基线记忆类型：Recent2、官方追忆、PairLedger 汇总、稳定记忆；需有快照身份，仅快照级。历史、当前用户、世界线和动作不借用此身份 |
| TEMPLATE_STATIC | cache anchor 和经可信生产点证实的全局静态模板 |
| LEGACY_OBSERVED | 自定义／描述／示例／动态主模板等已渲染兼容内容，无逐来源声明 |
| UNKNOWN | 缺证据、投影副本、缺 revision、合成 legacy locator 或其他无法唯一追踪的内容 |

可信来源与当前作用域不符时拒绝构造有效绑定并阻断 Plan；未知来源的兼容发送行为仍由原授权器决定。首次 pending 仍在成功请求后才可冻结，实际未发送、失败和取消不提交；配额、源 key 去重与冻结提交算法没有改动。

## 明确保留的来源债务

- `pair_source` 返回条目有 key、但部分分支没有保留已解析的单项 revision。本轮不更改冻结 key／配额算法来弥补，保留 UNKNOWN；后续如增强需完整审计来源身份兼容。
- `pair-summary:legacy:` 是合成 locator，不声称原生逐来源绑定。
- Recent2 可能包含 row pointers，但本轮不将整段汇总硬映射成一个原子来源；PairLedger aggregate revision 也不冒充逐条 revision。
- 官方追忆汇总已丢弃 CK3 单项 ID；`official_${ownerId}` 不是原生来源 ID。stable memoryId／version 也不等于原始对话 source key。以上保留快照级或 UNKNOWN，不宣称完整逐来源追踪。

V2 诊断仅增加五种证据等级的区块计数；原生 cached Token、派生 miss、本地前缀与服务端断点 UNKNOWN 的语义不变。新增来源字段不改变 Provider Usage 归一化或分组。

## 构建与回退

Core／App／Renderer／窗口／三主题预览统一 9.4.1。所有 Runtime 先改 src，再由既有 build／verify／deploy／verify --deployed 生成，仍为 306 项映射。新增两组测试登记发布清单，旧安全断言不降低。

临时诊断可用进程级 `VOTC_PROMPT_PLAN_MODE=legacy|shadow`，保留原来源和最终预算门禁。整体回退应从 e6bdc71 源码重建部署，不单独修改 out、不回退 APPDATA 或游戏状态、不重放 Action／Letter／ACK。Memory4／Durable／Year／Life 不恢复。完整回归及 EXE 交隔离 Windows CI，本机继续单进程、384MB Node；本版不再调用付费 API。

代码与自动化验收签署：`d1479db` 的 [CI 39579976545](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39579976545) 已通过 488 组完整发布、306 项构建部署与完整 EXE 冷启动／重启／媒体加载。payload 为 `89dd26ec7cac078d52f743c342947e1242acf9eb6a20b0c4ddf6f7127af8bc58`，与本机一致。真实 CK3、本机桌面输入、付费 Provider 与 Soak 未运行，继续保留候选。
