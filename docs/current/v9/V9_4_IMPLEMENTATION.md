# V9.4 PromptPlan 与缓存诊断实施记录

日期：2026-10-21。状态：**施工候选，未完成发布验收**。基线为 `2330bbcb6c068a4e42c19b26eba82f4034e6db63`；设计见 [V9.4 设计](V9_4_DESIGN.md)，结果见 [验证记录](V9_4_VERIFICATION.md)，后续工作见 [交接](V9_4_HANDOFF.md)。Core／App／UI 元数据为 9.4.0，表示同一 V9.4 候选，不拆分工作包版本。

## 用户确认的合同

- 静态与已冻结内容排在 Prompt 前面；追加历史及动态内容在后面。新 V9 排序版本为 `v9_4_static_first_1`。这是用户在设计之后明确授权的顺序调整；legacy／shadow 保持原消息顺序，以 `v9_4_compat_1` 比较旧版 Golden。
- 时间与第三人召回全文在合法注入、请求成功完成后，继续按当前对话及回应者冻结复用，不重复解析召回来源。首次待提交来源属于动态内容，失败或取消不提交冻结。换场、来源修订、Forget、知情变化仍按既有规则复核，冻结不扩大权限。
- Legacy Summary 协议 3.0、存储 2.5、Recent2、合法官方追忆及完整玩家 Pair 事项簿保持。2／3 人时间摘要最多 5 篇、4+ 人最多 3 篇；第三人摘要全场共享最多 3 篇。预算仍为 65%／70%／75% 与 80K／84K／96K 的较小可用值。完整合法来源放不下时先有界压缩旧对话，仍超限则发送前暂停，禁止静默裁剪。

## 实际接线

`src/app/main/prompts/prompt-plan-*.js` 提供七种语义块、作用域与来源证明、布局版本、前向消息贡献映射、纯序列化及连续前缀估计。现有 PromptBuilder 仍只执行一次授权渲染；Plan 消费其结果，不反向搜索正文、不二次召回来源。消息支持一块多条及多块合并，序列化核验每个贡献只使用一次。

`prompt-builder.js` 与 `conversation/conversation.js` 将当前回复指令、续写、人物知情／日期／来源复核接入 Plan。内部已证明的静态模板才进入稳定区；用户自定义块不能仅凭自报 stable／lifecycle 获得冻结权限。只有无法表示的旧 custom／description／examples 消息可降级为明确标记的 `LEGACY_OBSERVED`，作用域、来源与消息映射错误不允许降级。

`memory-system/player-centered-memory.js` 只增加 committed／pending 来源的只读投影，不改原有召回、配额或提交机制。修复 GLM 延后 main 的纯计账占位被误认为实际输出的问题；真实 main 保留且只注入一次。V9 生命周期 Token 分项按最终 Plan 求和，待冻结摘要也进入记忆诊断总额。

真实成功回调也同步接入新 pending 块：Conversation 优先从已发出的 pending 块提交当前 pending 来源；V9 仅复用 committed 块时只声明已冻结来源，不能顺带提交未发出的 pending。保留 legacy 回调行为及原成功／轮次门控。旧公开 `block.lifecycle` 继续使用原四种枚举，新语义种类另放 `semanticKind`，IR 与 V2 的 lifecycle state 维持独立。

`providers/effective-request.js` 及既有 Provider／Service 在每次真实 transport 前观察最终协议映射后的有效请求，重新核验预算、完整消息元数据、模型／端点、来源及取消状态。保留 SDK 零隐式重试、既有有界显式重试和未知送达不透明重发原则。Chat、续写、Action、Summary、Letter 共用此边界；无 Chat Plan 的路径明确为 LEGACY_OBSERVED，不伪造 Owner 证明。最终请求正文只保存在内存，不持久化。

`analytics/cache-usage-reconciliation.js`、`provider-diagnostics.js`、IPC／Preload 与既有 Renderer 诊断区增加 V2。原生 zero／missing／invalid、派生 miss、本地前缀估计和变化块分开；真实服务端缓存断点始终 UNKNOWN。仅合法完成且原生字段有效的样本进入分组加权率。Zhipu 保留旧 V1 raw_usage 形状，新增固定白名单的未强制转换原生证据，防止 null 被计成原生零。

## 来源路径回归

原基线的 `scoped-path.js` 在本机存在 junction 漏检：lstat 将其报告为普通目录，普通 realpath 也返回别名；原生 Windows realpath 才返回真实目标。新增 canonical 检查拒绝重定向，并保留不存在叶节点的祖先检查。大小写仅异路径按磁盘条目拼写核对，防止大小写敏感目录被统一小写后混同。相关修补与自动化边界单列于验证记录，未借此放宽原来源断言。

## 构建与配置边界

新源文件均加入 `build/runtime-inputs.json`，共 306 项映射。先编辑 src/app，再构建、部署及逐项哈希核验。`VOTC_PROMPT_PLAN_MODE=legacy|shadow|v9` 是进程级排查入口，默认 v9，不迁移玩家设置或历史存储。动作／信件载体、ACK 与旧未知效果均不重放；不恢复 Memory4、Durable、Year／Life。多 Mod 兼容工程保持独立。

`np-test.exe` 已确认为本地 Microsoft Notepad 调试副本，从 Git 索引移出并添加精确忽略；本机文件保留，不属于 VOTC 发布入口。
