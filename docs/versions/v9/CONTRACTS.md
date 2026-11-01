# CONTRACTS 版本册

原文按来源合并，保留设计、实施、修复、失败与待验结论；历史文字中的“当前”只属于其原版本。源码快照：`9449b0a4bc6b0616452b31fb8c79eafeae829bf5`。旧页仅保留链接兼容索引。

- [V9_ARCHITECTURE_BOUNDARY.md](#source-590563bc3f28)
- [V9_BASELINE_BEHAVIOR_CONTRACTS.md](#source-3335bf67b34f)
- [V9_COMPATIBILITY_MOD_SEPARATION.md](#source-12085bd37d6d)
- [V9_DATA_OWNERSHIP_LEDGER.md](#source-d46afc9d29a1)
- [V9_DECOMMISSION_LEDGER.md](#source-535ef8418bad)
- [V9_ROADMAP.md](#source-850ece6044d9)
- [V9_VERSION_ALIGNMENT.md](#source-7b709dd3a0b3)

<!-- chapter:source-590563bc3f28:start -->
<a id="source-590563bc3f28"></a>
## 来源：docs/current/v9/V9_ARCHITECTURE_BOUNDARY.md

原文规范化 SHA-256：`0e290f23ae833b66825d9e05f141ccaad1a36c0ffdd9ae6edee94be01bdf1ceb`。

<a id="source-590563bc3f28--v90-当前架构与权限边界"></a>
# V9.0 当前架构与权限边界

V9.1 更新：可编辑源现为 `src/app/`，`resources/app/out` 是经校验生成的资源；本文件下方保留 V9.0 审查快照。最新路径与阶段归属见 [V9.1 架构移交](V9.1.md#source-40cd087d25a9)，构建与版本见 [源码构建](V9.1.md#source-6765aa1852c9)。本次没有改变下方业务权限边界。

日期：2026-10-11。下表是实际打包源码地图，非V9.1重建成果。

发行版本：项目 V9.0／核心 9.0／App 包 9.0.0／VOTC Workshop Mod 2.0.5。Memory Engine 4.0、协议 3.0、摘要存储 2.5、Official Action 2.0.3 保留；独立 Three-Mod 仍为 1.0.6。当前版本更新记录见[版本对齐](CONTRACTS.md#source-7b709dd3a0b3)。

| 责任 | 当前生产入口 | 数据权限／方向 |
| --- | --- | --- |
| 启动组合根 | `resources/app/out/main/main.js` | 构造服务与IPC；不把out称为可重复构建的正式src |
| 对话／Presence | `conversation/conversation.js`、`conversation-manager.js` | 当前会话、合法在场、每NPC响应与终局；调用Memory/Worldline/Provider |
| 认知与叙事 | `memory-system/memory-engine.js`、`memory4-engine.js`、`memory4-store.js` | Campaign×Owner；观察／披露／Forget先于Prompt；Derived不能覆盖原始事实 |
| 当前事实／历史 | `worldline/worldline-service.js`、`historical-system/` | CK3当前事实只读；历史时点／定义身份有界，不写游戏状态 |
| Provider | `provider-service.js`、`providers/` | 接受授权后的Prompt；诊断context不能进入HTTP、缓存锚点或Prompt |
| 动作 | `actions/run-file-manager.js`、`run-command-recovery.js` | FIFO、UTF8 BOM原子替换、未知效果不重放，ACK与CONFIRMED区分 |
| 信件 | `letters/letter-manager.js`、`letter-log-reader.js`、`letter-date-session-scanner.js` | 实际DATE/session、Effect/ACK/收信回执、一次归档；不乐观确认 |
| UI／IPC | `out/preload/preload.js`、`main/ipc/register-ipc.js`、`out/renderer/` | UI不直接写Memory；指标输入严格白名单且不含文本；不同进程只传相对时长 |
| 原生桥 | `compatibility-patches/v8.15.2-letter-runner/` | VOTC自身Bridge，保留至V9.6，当前运行文件在Workshop独立发行 |
| 可选兼容 | 独立 CK3-Three-Mod-Compatibility 工程 | 不属于上述运行依赖；自有官职政策、源码与QA，VOTC只消费合法导出 |

V9.0只建立诊断、CI与项目边界；ConversationService/JsonRepository等规划接口没有实现，V9.1—V9.6分阶段推进。Memory4显示4.0、协议3.0、摘要存储2.5及官方Action2.0.3合同保持。

<!-- chapter:source-590563bc3f28:end -->

<!-- chapter:source-3335bf67b34f:start -->
<a id="source-3335bf67b34f"></a>
## 来源：docs/current/v9/V9_BASELINE_BEHAVIOR_CONTRACTS.md

原文规范化 SHA-256：`a1e0ea1a415e2dffda6f0c5b9acb759b9f7b9865985152166fd05dba9aecfe18`。

<a id="source-3335bf67b34f--v9-永久行为合同与回归映射"></a>
# V9 永久行为合同与回归映射

日期：2026-10-11。保留V8真实正反例，V9不修改这些语义；当前完整门禁会运行表中发布测试。

| 合同 | 不变量 | 现有正反例入口 |
| --- | --- | --- |
| B-MEM-01 | Campaign/Owner/跨NPC隔离 | [test-v8.15.2-stranger-memory-isolation-qa.js](../../../scripts/test-v8.15.2-stranger-memory-isolation-qa.js) |
| B-MEM-02 | Forget/Tombstone及重启不复活 | [test-v8.15-durable-forget.js](../../../scripts/test-v8.15-durable-forget.js) |
| B-MEM-03 | 合法Presence/直接观察/Disclosure | [test-v8.14.1-opening-presence.js](../../../scripts/test-v8.14.1-opening-presence.js)、[test-v8.15.1-disclosure.js](../../../scripts/test-v8.15.1-disclosure.js) |
| B-MEM-04 | Narrative provenance及事件/获知时间 | [test-v8.15.2-derived-acquisition-independent-qa.js](../../../scripts/test-v8.15.2-derived-acquisition-independent-qa.js) |
| B-MEM-05 | Legacy保守读取与迁移 | [test-v8.15-legacy-recall.js](../../../scripts/test-v8.15-legacy-recall.js) |
| B-WORLD-01 | Current Truth与时点历史边界 | [test-v8.15.2-world-memory-scope-audit.js](../../../scripts/test-v8.15.2-world-memory-scope-audit.js) |
| B-ACT-01 | FIFO/ACK/CONFIRMED及STALLED不重放 | [test-v7.10-rc6-rev3-run-command-recovery.js](../../../scripts/test-v7.10-rc6-rev3-run-command-recovery.js)、[test-v8.8.4-incident-regression.js](../../../scripts/test-v8.8.4-incident-regression.js) |
| B-LETTER-01 | LOAD/DATE及收信一次归档 | [test-v8.15.2-letter-receipt-startup-recovery.js](../../../scripts/test-v8.15.2-letter-receipt-startup-recovery.js)、[test-v8.15.2-outbound-bridge.js](../../../scripts/test-v8.15.2-outbound-bridge.js) |
| B-PROMPT-01 | Provider不使用越权或被忘记忆 | [test-v8.15.1-recall-ui.js](../../../scripts/test-v8.15.1-recall-ui.js)、[test-v8.15.1-disclosure.js](../../../scripts/test-v8.15.1-disclosure.js) |
| B-UI-01 | 三主题/Memory页面与异步状态 | [test-v8.14-e-memory-ui.js](../../../scripts/test-v8.14-e-memory-ui.js)、[test-v8.15.2-ui-races.js](../../../scripts/test-v8.15.2-ui-races.js) |
| B-PERF-01 | 默认关闭/有界诊断/错误隔离 | [test-v9.0-performance-trace.js](../../../scripts/test-v9.0-performance-trace.js)、[test-v9.0-independent-qa.js](../../../scripts/test-v9.0-independent-qa.js) |
| B-MOD-01 | 独立兼容非生产必需/保留Bridge | [test-v9.0-independent-qa.js](../../../scripts/test-v9.0-independent-qa.js) |

CK3/Provider/打包结果分别登记，不把Node夹具当作游戏效果确认。测试映射代表可执行入口，不声称覆盖所有将来工况；B-MOD的有/无Three-Mod真实CK3导出仍待实机，独立工程三组官职QA不再进入VOTC Release。

<!-- chapter:source-3335bf67b34f:end -->

<!-- chapter:source-12085bd37d6d:start -->
<a id="source-12085bd37d6d"></a>
## 来源：docs/current/v9/V9_COMPATIBILITY_MOD_SEPARATION.md

原文规范化 SHA-256：`a86f39575b8351380dc91715a1f474e7c2dddf07c917b14e28c76072dcde9ca5`。

<a id="source-12085bd37d6d--独立兼容工程迁移"></a>
# 独立兼容工程迁移

日期：2026-10-11；本地迁移 LOCAL_PASS，远端 CI／游戏验证另列。

独立远端由用户创建：[CK3-Three-Mod-Compatibility](https://github.com/wsdsb-111/CK3-Three-Mod-Compatibility)。本轮不上传或push。独立工作目录为 `C:/Users/97330/Documents/Codex/CK3-Three-Mod-Compatibility`，安装目录仍是 `E:/Documents/Paradox Interactive/Crusader Kings III/mod/VOTC_Three_Mod_Character_Name_Compatibility`，两者含义不同。新工程已初始化main和指定origin，尚无commit。

迁移交易：冻结13个Mod与三个仅builtin依赖QA → 独立mod/tests/docs/CI完整复制 → manifest源/目标hash → 全新独立副本三组测试与缺文件负例 → 从VOTC工作树移除相应副本和三个release项 → VOTC全门禁与无必需依赖检查。历史V8报告保留，通过独立repo外链查功能源；不重写Git历史。

`tianjia-benji-repair`只含README和两个手工CK3补丁，无resources/scripts生产调用，按可选上游补丁复制至独立patches；不是Three-Mod1.0.6自动安装内容。`v8.15.2-letter-runner`是VOTC DATE/RunFile/ACK正式桥，留在原位，不与兼容工程迁走。

新repo的版本仍1.0.6，本轮不改官职或称谓效果，不改已安装Mod、Playset、原三上游Mod。独立CI与CK3验证分别为CI_PENDING/CK3_PENDING；最终复制/hash与本体移除结果在[验证报告](V9.0.md#source-7f8563a38eee)登记。

已完成：13个Mod文件原样复制、3个QA只替换modRoot、3个可选天家补丁原样归档；清单19项源/目标SHA逐项通过，独立QA另从冻结Git blob／CRLF checkout复核。独立临时干净副本 `node tests/run-tests.js` 3/3通过；移除必需office脚本的副本按预期ENOENT／exit1。随后从VOTC当前工作树移除19个源文件及三项release登记，resources/scripts/workflow无兼容源必需引用。历史V8路径和测试命令保留为当时记录；当前命令在独立工程运行，不能照旧在VOTC执行。

独立工程的 `migration-manifest.json`、`docs/migration-from-votc.md` 与 `THIRD_PARTY_NOTICES.md` 保存源SHA、变换、退役和许可来源；没有擅自创建许可证。VOTC用户数据3536个既有文件、Workshop Bridge7文件、安装Mod13文件在施工后重新核对冻结SHA一致，见[保留核验](../../current/v9/preservation-verification.json)。

<!-- chapter:source-12085bd37d6d:end -->

<!-- chapter:source-d46afc9d29a1:start -->
<a id="source-d46afc9d29a1"></a>
## 来源：docs/current/v9/V9_DATA_OWNERSHIP_LEDGER.md

原文规范化 SHA-256：`d975d9851cbd624b66f657ba2f2d07d42c77722644c1e5c9c0e02dc97f49cdb7`。

<a id="source-d46afc9d29a1--持久数据责任登记"></a>
# 持久数据责任登记

日期：2026-10-11。路径为逻辑用户数据根相对路径，实例中的玩家正文、Key及存档不进入仓库。

| 数据／Source of Truth | producer／writer | Scope与schema | 原子性／恢复／删除条件 |
| --- | --- | --- | --- |
| 有向 Legacy 摘要 | `summaries/summaries-manager.js`、`memory-system/memory-store.js` | Owner→Counterpart，摘要2.5兼容 | 既有文件合同；绑定Campaign需证据；不能按文件年代批量删除 |
| Memory4 entry／metadata／index | `memory-system/memory4-store.js`、`memory4-engine.js` | Campaign×Owner，engineVersion3.0 | Store原子写入／修订校验；entry为来源事实，index为派生定位；Forget/Tombstone先过滤，重建不能复活 |
| years／life／派生指针 | `memory-system/memory4-derived.js` | 同Owner/Campaign、sourceRevision，Year1500/Life1000硬限 | 来源当前且权限合法才发布；保留手改策略；脏数据可重建，不能替代Detail |
| episodes／memory记录／index | `memory-system/memory-store.js`、`finalization-coordinator.js` | Finalization/source provenance | 多文件完成有恢复边界，单文件rename不宣称多文件事务；Legacy reader继续保留 |
| Forget／Disclosure／Known Entity | `memory4-store.js`、`memory4-forget.js`、`memory4-disclosure.js` | 来源修订、knownBy与Owner | 永久撤销授权优先；不是可随意删的缓存；错误读失败关闭 |
| Finalization／接收恢复快照 | `finalization-coordinator.js`、`letter-memory-finalization.js` | finalizationId＋双方来源证明 | 持久交接后才清恢复记录；重启不重复请求、不重复归档 |
| pending-letters.json | `letters/letter-manager.js` | version4、收信证明、待投递状态 | 临时文件rename；锁与真实Effect/ACK/回执联合校验；未知效果不重寄 |
| run-command-queue.json／run/votc.txt | `actions/run-file-manager.js` | 命令ID、owner、epoch | 持久awaiting_ack先于UTF8 BOM原子载体；写入未知但无ACK为STALLED，绝不盲目重放 |
| Worldline checkpoint／supplemental／archive | `worldline/`、`historical-system/worldline-store.js` | Campaign、Branch、时点与实体绑定 | Current Truth只读；定义／运行身份一对一，冲突拒绝，历史规划不覆盖现实 |
| 设置／Provider secret／用户Prompt | `config/settings-repository.js`、PromptConfig及SecureProviderSecrets | 用户安装实例 | 保留既有安全读写；不导出key、不批量改默认Prompt，不纳入性能trace |
| usage analytics | `analytics/usage-analytics.js` | 原生usage／明确估算 | 厂商Cache Hit与本地前缀结构估计分开；非游戏事实权威 |
| 性能诊断 | `runtime/startup-performance-trace.js` | 每次启动随机盐、匿名会话、有限样本 | 默认关闭，有限内存，用户触发脱敏JSON导出；诊断失败不能阻塞业务，无恢复重放职责 |

每项的备份程序为V9私有冻结副本加哈希校验；恢复必须核对Scope/当前版本，不覆盖唯一存档或撤销已确认ACK。JsonRepository规划端口尚未实现；V9.2才治理多文件事务与索引闭环。

<a id="source-d46afc9d29a1--v92-更新"></a>
## V9.2 更新

上文 JsonRepository 尚未实现为前阶段快照。当前 ScopedJsonRepository 注入同一个 Memory4Store／MemoryStore，仅协调授权读取、候选、原写命令和只读审计。完整 logicalKey／canonicalOwner／writer／scope／schemaVersion／revision／hash／indexType／recoveryAuthority／legacyReader／cleanupPolicy／proof 映射见 [V9.2 数据权威与恢复](V9.2.md#source-e419ea1084a4)。RunFile、Letter、Worldline、设置和凭据仍归各自 owner。

<!-- chapter:source-d46afc9d29a1:end -->

<!-- chapter:source-535ef8418bad:start -->
<a id="source-535ef8418bad"></a>
## 来源：docs/current/v9/V9_DECOMMISSION_LEDGER.md

原文规范化 SHA-256：`afd767f40c9d8c4c919866ebf90f7bf5ad247cdc3cc51347c21f762534de3014`。

<a id="source-535ef8418bad--2026-11-01-当前退役台账覆盖说明"></a>
# 2026-11-01 当前退役台账覆盖说明

当前执行以 [V9.7 函数/配置/IPC/数据权威台账](V9.7.md#source-c92823293f85) 为准。旧 V9.7 Workshop 分发已取消；新 V9.7 负责退役审计，新 V9.8 负责 RC/Soak。下方保留原阶段判定及历史结果，不自动授权新删除、恢复旧 Memory4 或修改用户数据。

<a id="source-535ef8418bad--v9-退役台账"></a>
# V9 退役台账

日期：2026-10-11。没有引用与恢复证据的内容统一 KEEP_UNTIL_PROVEN。

| legacyPath | owner／当前调用者 | replacement／reader | 数据风险、测试和回滚 | 状态／最早阶段 |
| --- | --- | --- | --- | --- |
| Three-Mod源及三QA | 独立兼容；仅自身QA与manifest引用 | 独立repo mod/tests/CI | 完整复制/hash/独立3绿后移除13源、3QA、3release登记；回滚冻结archive；不动已安装Mod | LOCAL_PASS，V9.0 |
| tianjia-benji-repair | 上游天家手工决策补丁；无VOTC生产引用 | 独立repo patches/可选归档 | README＋两原件逐字节保留并核验后移除旧副本；无游戏内验收；不自动部署 | 审计与归档LOCAL_PASS，V9.0 |
| v8.15.2-letter-runner | VOTC正式DATE/RunFile/ACK桥 | V9.6 ck3-mod正式源规划 | 删除会断游戏通信；保留后台投递/LOAD去重测试 | KEEP至V9.6+验证 |
| action-system历史目录／旧AE测试 | 历史AE，正式路径Official2.0.3 | 官方动作服务；历史归档reader | 不重新接入生产；先查全引用再移除，保留历史证据 | KEEP_UNTIL_PROVEN，V9.8 |
| Legacy摘要／episodes／recovery | Memory4与终局仍消费 | 兼容reader继续有效 | 玩家数据／授权／遗忘；无清理实验，永久反例保护 | KEEP_UNTIL_PROVEN，V9.2/9.8 |
| 旧Prompt block ID／Provider特判 | PromptBuilder与厂商serializer | V9.3/9.4接口规划 | Cache锚点和源权限是兼容合同，不在V9.0重排 | KEEP_UNTIL_PROVEN |
| 打包out与Renderer assets | 当前唯一实际生产入口 | V9.1正式源／build规划 | 不能当生成垃圾删除，冻结zip/LFS保持 | KEEP至构建行为等价 |
| V6—V8历史文档 | 历史事实与回滚索引 | 新V9入口链接旧报告 | 保留真实当时结果与链接，不重写旧PASS | 永久归档 |

施工状态与回滚索引由[验证报告](V9.0.md#source-7f8563a38eee)更新；任何退役不删除运行时Memory、Forget、信件、日志或存档。

<!-- chapter:source-535ef8418bad:end -->

<!-- chapter:source-850ece6044d9:start -->
<a id="source-850ece6044d9"></a>
## 来源：docs/current/v9/V9_ROADMAP.md

原文规范化 SHA-256：`3235456c2c4428309f61fbc5607271f79db5fce342170ac366f204879f380b7b`。

<a id="source-850ece6044d9--2026-11-01-当前路线覆盖说明"></a>
# 2026-11-01 当前路线覆盖说明

旧 V9.7「Workshop 一体化分发 Runtime EXE」永久取消，不开发 bootstrapper，不向 Steam 上传 Runtime。当前 V9.7 承接原 V9.8 Legacy Decommission；新 V9.8 承接原 V9.9 RC／Soak／Full Freeze。Runtime 与 Workshop 独立维护、独立版本，通过现行 Bridge 配对。当前实施见 [V9.7](V9.7.md#source-caf83136db36)，下一阶段见 [移交](V9.7.md#source-2bb5ed16e927)。以下旧路线是历史计划快照，不代表当前进度、在线 Memory4 合同或新版本通过情况。

<a id="source-850ece6044d9--voct-v9-阶段开发总路线修订版"></a>
# VOCT V9 阶段开发总路线（修订版）

实施索引补记（2026-10-12）：[V9.2.1 缓存专项候选](V9.2.md#source-1f73e36871b4) 仅修复现有 Durable 前缀/Forget 重试及诊断，缓存效果 HOLD。此索引不修改下方历史路线、阶段承诺或 V9.3/V9.4 范围。

> **文档类型**：Roadmap / Architecture Charter / ADR 索引（路线与边界，不代替逐文件施工文档）  
> **文档版本**：V9 Roadmap Revision 2 · 2026-10-11  
> **审查对象**：[wsdsb-111/VOCT-NEW](https://github.com/wsdsb-111/VOCT-NEW)，`main`  
> **仓库快照**：`3c49364fb1f9d4f1a90c6c09df3cc3966a01b8c4`（2026-10-10 03:38:58 UTC）  
> **阶段状态**：**V8 功能冻结（用户于 2026-10-11 确认）；V9.0 待实施**。此处“冻结”是产品/开发决策，不表示所有远端 CI 与新场景实机问题已关闭，也不表示已经创建 Git tag。  
> **执行入口**：配套《V9.0设计开发文档_修订版.md》。任何实际施工前应再次检查 HEAD、工作区、安装版与 CK3 Workshop 文件指纹。

---

<a id="source-850ece6044d9--0-执行摘要这次修订改变了什么"></a>
## 0. 执行摘要：这次修订改变了什么

V9 的方向维持不变：**不以堆砌新玩法为主，而是把 V6–V8 演化而来的工程建成可重建、可维护、可测试、可安装、可更新、可回退的产品**。

在上传的旧路线基础上，新增三个 V9.0 优先事项，并修正一个事实基线：

1. **把“游戏刚进入时，前几轮对话反复卡一下，后续自然恢复”列为 V9.0 的 P1 性能事故（根因未明）。** 先分段打点、复现、对照，再做最小修复；不凭观察直接删轮询、禁用信件管道或关闭 Memory4。
2. **将东方王朝／汉番礼制／天家宗仪独立兼容工程从 VOCT 的开发与发布体系中分离。** 兼容 Mod 继续独立存在、独立测试、独立发版；不修改三款上游 Mod，不清理玩家本地已安装副本，也不把独立兼容 Mod 变成 VOCT 的必需依赖。
3. **修复远端 Release Regression 的基线问题。** 最新 HEAD 的 GitHub Actions 为 Failure；可见的直接失败发生于历史版本对照脚本执行 `git show fda1b8e:...`，而工作流浅克隆未取得该历史对象。V9.0 必须恢复真实可重复的 CI Gate，不允许通过跳过反例测试“刷绿”。
4. **规划基线由旧文档中的 `0c290d8` 更新为当前 `3c49364`。** 该 HEAD 包含 V8.15.2 多轮后续修复与 Three-Mod 1.0.6 的提交；仍须在 V9.0 开工前核验真实运行包/Mod 是否与此一致。

<a id="source-850ece6044d9--v9-的九项确定性决策"></a>
### V9 的九项确定性决策

- **V8 行为冻结，V9 采用受控变更**：新问题进入 V9，不在 V8 上继续无序叠补丁；冻结快照只能作对照，不可直接覆盖。
- **保留 Memory Engine 4.0**：不开发 Memory5；保留现有 `engineVersion: 3.0` 兼容协议和摘要 2.5 存储合同，除非后续有明示的版本化迁移。
- **继续使用 JSON**：V9 不进行 SQLite/SQL 迁移，也不做 JSON/SQL 双写；优先治理 Scope、索引、事务恢复、单一权威记录。
- **保持知识授权边界**：Owner / Campaign / knownBy / Presence / Direct Observation / Disclosure / Source Provenance / Forget / Tombstone / Recovery 不允许因提速或架构迁移被弱化。
- **一个产品、一个规划中的 Workshop 分发入口、两个独立运行组件、一个 Bridge 协议**：CK3 Mod 不与 Electron/Node Runtime 合并进程。
- **独立兼容工程退出 VOCT 产品边界**：Three-Mod 兼容不随 VOCT V9.7 Workshop 本体发布，不参与 VOCT 的 Release blocker；VOCT 的**自身 CK3 Bridge 补丁**则仍受 VOCT 管理。
- **Provider 合同统一，缓存策略不伪统一**：只有服务商返回的真实数据可称 Provider Cache Hit；本地 Prefix Fingerprint 只能称结构诊断。
- **任何重构先有行为证据再退役旧路径**：尤其不能重新生成旧记忆、误删信件、回滚已确认 ACK、恢复已遗忘来源。
- **性能优化以使用体验为目标而非只看 CPU 指标**：CK3 帧时间、Electron 主/渲染线程阻塞、请求首字延迟分开测量。

**产品口号**：`One Product · One Workshop Distribution · Two Runtimes · One Bridge Protocol`。  
**工程边界补充**：`Independent Compatibility Mods ≠ VOCT Product Dependency`。

---

<a id="source-850ece6044d9--1-核对到的仓库实际状态与证据等级"></a>
## 1. 核对到的仓库实际状态与证据等级

| 主题 | 当前能确认的情况 | 不能据此声称的结论 |
|---|---|---|
| 仓库 | `main` HEAD `3c49364`；根目录为 Windows 打包形态 | 不能宣称已有独立可重复构建的正式 `src/` 工程 |
| Runtime | `resources/app/out/main/` 含 conversation、memory-system、letters、worldline、providers、actions、ipc 等模块 | 不能把 `out/` 简单视为随时能从干净源码再生的构建目录 |
| 发行包版本 | `resources/app/package.json` 为 Electron App `2.0.4` | 不能将 App 包版本混同业务功能 V8.15.2 或未来产品正式 2.0 |
| Memory | 现有 Memory4、Legacy 摘要、Episode/Memory、Year/Life 等多种 JSON 记录 | 不能把所有摘要误称为一场一文件，也不能声称完成统一存储改造 |
| 通信 | VOCT Workshop item `3346777360` 的日期／RunFile 桥接快照见 V8.15.2 报告 | 不等于 Workshop Mod 全量、最新且可重建源码已在 VOCT 仓库纳管 |
| 信件 | V8.15.2 退役旧 runner、引入 DATE 增量扫描；旧卡顿曾有用户报告“改善” | 不等于本次“前几轮短暂停顿”已定位和完全消除 |
| 兼容工程 | `compatibility-mods/VOTC_Three_Mod_Character_Name_Compatibility/`，Three-Mod 1.0.6；含独立官职交接逻辑 | 不属于 VOCT NPC 对话产品核心；不能在整理仓库时误删本地已安装 Mod |
| 测试 | 最近实施报告记录本地 `409/409 PASS`（该报告中的时间点与环境） | 不能等价于本次审查重新运行过 409 项 |
| 远端 CI | 2026-10-10 HEAD 对应 Release Regression Failure，历史 `git show fda1b8e` 缺对象 | 不能从 CI Failure 直接推定信件业务逻辑实际失败；亦不能宣称远端通过 |
| V8 冻结 | 用户明确作出 V8 正式冻结、转入 V9 的决定 | 仓库现有 tag、安装包 SHA、Workshop 文件与冻结承诺仍需 V9.0 落证 |

<a id="source-850ece6044d9--11-v8-应继承而非重写的能力"></a>
### 1.1 V8 应继承而非重写的能力

Memory4 的叙事 Detail + 结构化知识、第三人和时间召回、逐 Owner 认知、可观察特质、披露事实版本、源权限与持久遗忘；Worldline Current Runtime Truth 和历史资料／时点检索；多人 Presence 和终局 Finalization；官方 Action System 2.0.3、RunFile 队列／ACK／效果回读；信件独立日期、宝物回执与归档恢复；三主题 UI 及现有多 Provider 适配。

<a id="source-850ece6044d9--12-证据分层"></a>
### 1.2 证据分层

统一使用以下等级，报告不得越级使用“PASS”一词：

1. `CODE_REVIEWED`：读到生产源、调用链和配置，但未执行。
2. `LOCAL_TEST_PASS`：本地自动化回归通过，附 commit、命令、退出码。
3. `CI_PASS`：远端指定 SHA 的 GitHub Actions 成功。
4. `PACKAGED_PASS`：实际 VOTC.exe、Renderer、IPC 的隔离或真实启动验证。
5. `PROVIDER_LIVE_PASS`：真实 Provider 请求／结构化输出／流式／usage 证据。
6. `CK3_LIVE_PASS`：明确游戏版本、存档／开局、启用 Mod 组合、Workshop 指纹的实机确认。
7. `SOAK_PASS`：长时间与连续回合压力场景的可复现记录。
8. `USER_CONFIRMED`：用户明确确认某个操作结果；可以与其他证据并列，但不能替代未采集的具体指标。

上表为分类维度，并非所有测试都必须严格按数字顺序执行。**V9.0 之前的报告与截图是历史证据，不自动继承为 V9.0 本轮结果。**

---

<a id="source-850ece6044d9--2-已知启动逐轮卡顿v9-新增风险基线"></a>
## 2. 已知启动／逐轮卡顿：V9 新增风险基线

<a id="source-850ece6044d9--21-症状事实"></a>
### 2.1 症状（事实）

2026-10-10 用户实机观察：进入游戏及开始对话的初期，多轮对话各有一次明显停顿；继续运行一段时间后，对话趋于正常。**尚无具备统一时钟的帧时间、调用栈或逐回合耗时日志；原因待验证。**

<a id="source-850ece6044d9--22-需要排查但不可先行定罪的生产路径"></a>
### 2.2 需要排查但不可先行定罪的生产路径

| 路径 | 仓库中已有事实 | V9.0 要获取的证据 |
|---|---|---|
| CK3 GUI 原生日期与 `run votc.txt` | V8.15.2 报告记录原生桥约每 2 秒轮询；属于正式信件与 Action 传输的一部分 | 游戏帧时间、每次调用耗时、游戏是否因双 consumer 而短暂阻塞 |
| Electron 剪贴板 Listener | `main.js` 当前仍是 `setInterval(..., 100)` | 轮询次数、单次成本、游戏／非游戏焦点、相同输入重复处理情况 |
| Conversation 初始化 | `conversation.js` 在开场解析 CK3 日志、加载摘要、保存可观察认知、同步官方追忆 | `initializeGameData` 各步骤 wall time、同步 I/O、Owner/人物数量与耗时曲线 |
| 认知快照 | `captureDisclosureProfiles` 对相关 Owner 遍历人物并形成快照；`observeVisibleTraits` 做同场合法观察 | 首次调用数量、Owner × Entity 数量、内存／I/O；必须保留合法来源门禁 |
| Worldline 预取 | 开场 `prefetchFrozenWorldline()`，可包含 Canon 准备与候选查询 | 冷预取与重复使用分段耗时、主线程阻塞、缓存命中依据 |
| Memory／Prompt | 每轮存在 Memory Context、Prompt 构建和 Provider 调用 | Recall、读盘、Token 估算、Prompt 序列化、真实 TTFT 分开计时 |
| LetterLogReader / DATE | V8.15.2 已加入分块冷扫描与增量更新，且仍需 ACK 看门狗 | 冷扫描 bytesRead/duration/maxBlock、增量模式、重启次数、队列长度 |
| Renderer | 对话列表、状态展示与接收流式 Token | 点击到 IPC、渲染 Long Task、首 token 至绘制的延迟 |

**不把“热身后恢复”自动解释为缓存命中。** 也可能是启动恢复队列完成、日志冷扫描结束、Worker 初始化结束、CK3 自身加载收尾或多个因素叠加。

<a id="source-850ece6044d9--23-原则性验收"></a>
### 2.3 原则性验收

V9.0 应能用相同环境、相同存档／Provider 分别给出冷启动前 10 轮与稳定后 20 轮的 `P50/P95`，并明确是哪一段（CK3 帧、主线程、渲染、Recall、Prompt、网络 TTFT、日志扫描）发生了差异。若无法复现，应保留可匿名化的诊断入口和“未复现”结论，**禁止凭猜测关闭必要功能**。

---

<a id="source-850ece6044d9--3-独立兼容-mod-与-voct-核心的边界"></a>
## 3. 独立兼容 Mod 与 VOCT 核心的边界

<a id="source-850ece6044d9--31-需要独立维护的工程"></a>
### 3.1 需要独立维护的工程

当前仓库中可明确识别：

```text
compatibility-mods/
  VOTC_Three_Mod_Character_Name_Compatibility.mod
  VOTC_Three_Mod_Character_Name_Compatibility/
    descriptor.mod
    common/
    events/
    gui/
    localization/
```

该兼容项目现为 Three-Mod 1.0.6；面向 **Oriental Empires（东方王朝）／Eastern Ritual and Governance（汉番礼制）／天家宗仪** 的人物显示、政体及流官任命规则，不依赖 VOCT 的对话引擎完成业务功能。相关仓库测试至少有：

- `scripts/test-three-mod-character-name-compatibility.js`
- `scripts/test-v8.15.2-celestial-office-release.js`
- `scripts/test-v8.15.2-celestial-office-independent-qa.js`

这三组目前登记在 VOCT `scripts/test-manifest.js` 的 `releaseChecks`；**分离时必须迁走对应测试与 fixtures，调整清单并重新验证**，而非仅移动 Mod 目录。

`compatibility-patches/tianjia-benji-repair/` 是另一个上游兼容性质的补丁目录；V9.0 应逐文件核验其独立性，再决定纳入独立兼容仓库的对应子项目，**不能未经审计按目录名统删**。

<a id="source-850ece6044d9--32-必须留在-voct-的工程"></a>
### 3.2 必须留在 VOCT 的工程

`compatibility-patches/v8.15.2-letter-runner/` 虽然位于 `compatibility-patches`，实质是 VOCT Workshop Mod 的**原生 Bridge / DATE / RunFile / ACK** 运行配套快照；它与 VOCT Runtime 有协议耦合。**本目录必须保留至 V9.6 纳管和 V9.7 分发接替完成**，不得与 Three-Mod 一起删除。

`VOCT → CK3` 的角色数据导出、`VOTC:IN`、`VOTC:DATE`、Trait Canonical Key、Action ACK、Letter 回执属于 VOCT 产品接口；`东方王朝 ↔ 汉番礼制 ↔ 天家宗仪` 的官职、称谓冲突解决属于独立兼容工程。代码内若存在有限交叉，则通过“可选能力／输出字段合同”维持，不形成必须安装 Three-Mod 的依赖。

<a id="source-850ece6044d9--33-推荐分离方案迁移前提而非已完成事实"></a>
### 3.3 推荐分离方案（迁移前提，而非已完成事实）

建议建立单独 Git 仓库，例如 `CK3-Three-Mod-Compatibility`（**建议名称，未创建**），完整复制当前源代码、描述符、脚本、fixtures、测试、对应历史说明、版本与许可元数据。先在独立环境 PASS，再由 VOCT 当前工作树移除已迁出的**被跟踪副本**和独立测试入口，保存 README 外部链接与历史归档。VOCT Git 历史保持不改写；如需保留独立项目提交史，可在临时镜像上做 `git subtree split` 或等价提取，禁止在 VOCT 主仓库上运行破坏性历史重写。

**不触碰**：CK3 本地安装目录、当前 Playset、存档、上游三款 Mod、已保存兼容工程备份、VOCT Runtime Memory4 与信件记录。`git rm` 的目标仅是验证完毕的 VOCT 工作树被跟踪副本；不等同于卸载玩家游戏 Mod。

<a id="source-850ece6044d9--34-完成判断"></a>
### 3.4 完成判断

- 独立仓库源码、测试、CI、安装说明和最低兼容版本齐备；Three-Mod 1.0.6 源码行为与迁出前一致。
- VOCT 在 **不安装** Three-Mod 时，核心聊天、导出、Memory4、Action、Letter 正常；在 **安装** Three-Mod 时，接口字段仍正确，不以兼容工程内部规则判断对话是否可运行。
- VOCT Release Regression 不再运行 Three-Mod 自身测试；独立项目另有有效自动测试；无悬空引用、CI 无假绿。
- 后续 Three-Mod 1.0.x 发版不增加 VOCT V9 的发布阻塞项，反之亦然。

---

<a id="source-850ece6044d9--4-不变的-memory4worldline-与持久化原则"></a>
## 4. 不变的 Memory4、Worldline 与持久化原则

<a id="source-850ece6044d9--41-认知授权不变量"></a>
### 4.1 认知授权不变量

```text
CK3 当前真实事实  ≠  NPC 被授权知道的事实  ≠  NPC 的叙事性理解与记忆
```

- `Scope = Campaign × Owner`；人物实体 ID、对话对象、事件时点／获知时点、来源与证据修订不可丢。
- 真实可观察内容仅由合法在场观察建立；非可见特质不得因 UI、缓存或摘要循环越权进入 Prompt。
- Forget 必须撤销所有生产召回资格；Tombstone、Recovery、旧索引和 Year/Life 不能重新使其生效。
- 历史事实、当前游戏事实、计划／未来事件分离；世界线不写入 CK3 的真实游戏状态。
- Legacy 旧摘要只有证据充分时才能绑定当前 Campaign，不能猜测归属或批量重写叙事文本。

<a id="source-850ece6044d9--42-数据层策略"></a>
### 4.2 数据层策略

继续使用 JSON，逐步建立受 Scope 约束的单一权威数据、索引与派生视图；允许按关系聚合 JSON 与独立 Memory4 entry 并存，但必须明确哪一层能写、哪一层可重建。原子 rename 仅是单文件承诺，多文件 Finalization 需要 journal / commit marker / idempotency 与崩溃恢复合同。

保留关系叙事、承诺、情绪和事件因果，不把 Narrative Detail 压扁为一串事实标签。Year/Life 是可追踪的长期视图，不是可以覆盖所有原始记忆的唯一存储。

<a id="source-850ece6044d9--43-adr"></a>
### 4.3 ADR

| ADR | 决策 | 再评估条件 |
|---|---|---|
| ADR-V9-001 | V9 使用 JSON，不采用 SQLite／SQL 双写 | 实测 P95/索引扫描／并发提交／损坏恢复出现可复现且 JSON 优化无效的问题 |
| ADR-V9-002 | Memory4 叙事与结构化知识双层共存 | 只能经过完整权限和 RP 品质双门禁评估，不能仅因目录改造调整语义 |
| ADR-V9-003 | Workshop 单入口目标；Mod 与 Runtime 独立运行 | 平台策略、执行文件、许可、更新行为由 V9.7 实测决定可行交付形态 |
| ADR-V9-004 | Three-Mod 与 VOCT 产品解耦 | 仅经双方协议变更审查，不能作为新的隐性必装项 |
| ADR-V9-005 | V9.0 性能先诊断再最小修复 | 有统一 trace、差异性复现、负向回归及真实游戏反馈后才改运行时循环 |
| ADR-V9-006 | 不跳过失败 CI 测试 | 对照 fixture 与环境可重建且 CI 对指定 SHA 成功后关闭 |

---

<a id="source-850ece6044d9--5-目标架构与依赖方向"></a>
## 5. 目标架构与依赖方向

```text
                          ┌───────────────────────────────┐
                          │  Presentation                 │
                          │  Electron UI / CK3 GUI        │
                          └───────────────┬───────────────┘
                                          │ IPC / Bridge
                          ┌───────────────▼───────────────┐
                          │  Application Services          │
                          │  Conversation / Presence       │
                          │  Memory / Worldline / Action   │
                          │  Letter / Character Profile    │
                          └───────────────┬───────────────┘
                                          │
                          ┌───────────────▼───────────────┐
                          │  Domain Contracts              │
                          │  Owner / Knowledge / Time      │
                          │  Evidence / Permission Rules   │
                          └───────────────┬───────────────┘
                                          │ Ports
                          ┌───────────────▼───────────────┐
                          │  Adapters                      │
                          │  Provider / JSON Repository    │
                          │  CK3 Bridge / External IPC     │
                          └───────────────┬───────────────┘
                                          │
                          ┌───────────────▼───────────────┐
                          │  Infrastructure                │
                          │  Node / Electron / File System │
                          │  Windows / Steam Distribution  │
                          └───────────────────────────────┘

      [单独的 Three-Mod Compatibility 工程，不属于上述运行依赖链]
```

最终建议目录（**目标形态，不是仓库现状，也不要求 V9.0 迁完**）：

```text
VOCT/
  packages/
    shared-contracts/       # 业务 DTO 与 Bridge 协议
    runtime-core/           # Application 组合根
    conversation/ presence/ memory/ worldline/
    action/ letter/ provider/ persistence/
    ck3-bridge/ desktop/ ui/
  ck3-mod/                  # VOCT 自身 Workshop Mod（V9.6 纳管）
  distribution/
    bootstrap/ workshop/ manifests/ release/
  tests/
    contracts/ integration/ regression/ e2e/ fixtures/ performance/
  docs/
    current/ archive/
  dist/                     # 构建输出，禁止作为唯一事实源码

# 独立项目：另一个仓库
CK3-Three-Mod-Compatibility/
  mod/ tests/ fixtures/ docs/ .github/workflows/
```

约束：Domain 不依赖 Electron、Provider 或 debug.log 原始文本；Provider 不直读 Memory4 内部；UI 不直写持久文件；CK3 Bridge 不绕过服务层改变知识权限；诊断层不记录用户对话内容和密钥。

---

<a id="source-850ece6044d9--6-v90v99-修订总览"></a>
## 6. V9.0—V9.9 修订总览

| 版本 | 里程碑 | 本阶段核心交付物 | 退出条件摘要 |
|---|---|---|---|
| **V9.0** | **Freeze Transition / CI / Startup Latency / Mod Separation** | 冻结清单、可追溯 CI、冷启动卡顿诊断或验证修复、独立兼容项目迁移、架构/数据合同 | 能复现/解释卡顿或如实记录未复现；CI 绿；兼容工程独立；V8 行为基线保存 |
| **V9.1** | Reproducible Source & Build | 正式可编辑源码、构建管道、锁定依赖、产物清单 | 干净环境能从源码构建 Runtime，与 V8 行为合同等价 |
| **V9.2** | Application Boundary & JSON Repository | 服务端口、Scoped JSON Repository、索引与多文件故障恢复 | Memory4 不变；授权一致；索引可核验、可安全恢复 |
| **V9.3** | Provider Platform | Adapter、能力矩阵、正常化输出、结构化/流式 Conformance | 支持的每类 Provider 都有合同证据；错误/usage 不伪造 |
| **V9.4** | PromptPlan & Cache | PromptPlan V9、前缀指纹、厂商 Serializer、缓存诊断 | 不泄露已忘/未授权知识；原生缓存指标可解释 |
| **V9.5** | UI Architecture / English | 组件化、异步状态治理、`zh-CN`/`en-US` | 中英文主要路径可读；Prompt/UI/Game 三种语言独立 |
| **V9.6** | CK3 Bridge & VOCT Mod Source | 仅 VOCT 自身 Mod 源码纳管、握手、能力版本、协议 Fixtures | Mod/Runtime 错配可提示，Trait/DATE/ACK/Letter 合同通过 |
| **V9.7** | Workshop Unified Distribution | 合规预审、payload/bootstrap/manifest、升级与回滚 | 若平台允许，订阅取得必要文件，不另上 GitHub 获取 Runtime；可回退 |
| **V9.8** | Legacy Decommission | 清债台账收口、旧 Flag/路径有证据退役、文档归档 | 不删可恢复数据、不丢迁移读者、不误删历史工具 |
| **V9.9** | RC / Soak / Full Freeze | CK3、Provider、Windows 安装、Memory、性能的完整矩阵 | P0/P1 关闭，CI 与升级/恢复实证完成 |

**顺序是合并 Gate 的依赖顺序，不是绝对日历。** 可以并行调研，不可越过行为/数据/恢复门槛将后续重构当成已完成。版本内部按 `V9.0.1` 等小版本拆包时，以单一合同和可回滚提交为单位。

---

<a id="source-850ece6044d9--7-各阶段范围与边界"></a>
## 7. 各阶段范围与边界

<a id="source-850ece6044d9--71-v90冻结性能ci解耦新增优先级"></a>
### 7.1 V9.0：冻结、性能、CI、解耦（新增优先级）

**必须完成**：

- 固化 HEAD/二进制/Workshop 来源、历史证据、数据备份及真实安装清单；建议创建不可变 V8 冻结标签（需实际执行并验证）。
- 对最新 CI Failure 进行对照修复：保留 `git show` 历史负向测试，短期可使 checkout 获取必要历史对象；长期可用经过校验的独立只读 fixture 避免历史耦合。两种方案均不得跳过测试。
- 建立冷启动／逐轮 trace；对剪贴板 100ms、CK3 2s 桥、日志冷扫描、认知快照、Worldline、Memory/Prompt、Provider、UI 分段排查。确认根因后仅进行受控最小修复。
- 完整、可回滚地分离 Three-Mod 兼容源与测试；其他 `compatibility-patches` 逐项归属；VOCT CK3 原生桥保留。
- 整理模块责任、数据 Source of Truth、写入路径与 `V9_DECOMMISSION_LEDGER.md`，建立针对实际数据规模的首份性能基线。

**不做**：SQLite、Memory5、UI 大重构、Prompt 重新排序、Workshop payload 分发、新的游戏玩法、不明原因批量删除计时器。

详见配套 V9.0 设计开发文档。

<a id="source-850ece6044d9--72-v91源码与构建闭环"></a>
### 7.2 V9.1：源码与构建闭环

从打包态 `resources/app/out` 建立可编辑源、Renderer/Preload/Main 构建管线；锁定依赖与生成产物 hash，旧构建作为对照 until parity；暂不强制 TypeScript。CI 包含源码构建 Smoke + 原有发布合同 + 文件完整性；本地构建与发布产物对比必须实际可重现。处理现有 LFS/打包二进制边界与许可清单。

<a id="source-850ece6044d9--73-v92服务分层及-json-整合"></a>
### 7.3 V9.2：服务分层及 JSON 整合

逐步建立 ConversationService、PresenceService、MemoryService、WorldlineService、ActionService、LetterService、PersistenceService。`readEntry(scope,id)`、`queryCandidates(scope,filter)`、`commitFinalization(batch)`、`forgetSource(scope,proof)`、`recover()` 是语义 Port 样例而非预先钉死的代码签名。索引优先定位候选、按需读取正文，修订号/校验和与多文件日志可恢复；旧 Legacy 与官方追忆保持兼容。

<a id="source-850ece6044d9--74-v93provider-平台"></a>
### 7.4 V9.3：Provider 平台

统一 `capabilities`、普通/流式生成、Structured Output、Result/Usage/Reasoning/FinishReason、超时取消、429/5xx、Unsupported 能力。V9.0 仓库现有 `player2`、`openrouter`、`openai-compatible`、`ollama`、`deepseek`、`gemini`、`zhipu` 配置入口；最终支持名单按实际可用端点与用户选择，不假设默认模型名称永远有效。各厂商的缓存方式、思考开关与费用以厂商结果为准。

<a id="source-850ece6044d9--75-v94promptplan稳定前缀与缓存"></a>
### 7.5 V9.4：PromptPlan、稳定前缀与缓存

语义块建议为 `GLOBAL_STATIC / CONVERSATION_FROZEN / RESPONDER_FROZEN / APPEND_ONLY_HISTORY / DYNAMIC_WORLDLINE / QUERY_DYNAMIC_MEMORY / CURRENT_TURN`。迁移旧 `v5/v6/v7/v813/deepseek_v89/glm_cache_v2` 的生产路径时先映射，不在本阶段直接删除旧配置。诊断区分 App 可控 Prefix Ratio/Fingerprint 与服务商的真实 cached token/hit/TTFT；未知应显示 UNKNOWN。

<a id="source-850ece6044d9--76-v95ui-与英文"></a>
### 7.6 V9.5：UI 与英文

整理 Conversation、Memory4、Worldline、Letter、Action、Provider、Diagnostics、Settings；统一 IPC Client、Stale Request、Context Epoch、Error Code，双语 `zh-CN`／`en-US`。明确 `uiLanguage`、`promptLanguage`、`gameLanguage` 互不联动。保留三主题内部键 `parchment/knight/ink` 及现有图片布局和中文可读性合同。

<a id="source-850ece6044d9--77-v96正式-voct-ck3-bridge"></a>
### 7.7 V9.6：正式 VOCT CK3 Bridge

**仅纳管 VOCT 自身** Workshop Mod 的脚本、导出、事件与 GUI，不导回已分离的 Three-Mod 业务工程。提出 `bridgeProtocol`、`modVersion`、`runtimeCompatibility` 与 capability 集合（如 `trait_key_v1`、`presence_v2`、`run_ack_v2`、`letter_v2`、`native_date_v1`）；支持 `SUPPORTED/DEGRADED/INCOMPATIBLE` 与最小协议错误描述。真实 CK3 导出、加载、读档、Action、Letter 和日期必须验证。

<a id="source-850ece6044d9--78-v97workshop-统一分发前置合规-gate"></a>
### 7.8 V9.7：Workshop 统一分发（前置合规 Gate）

计划同一 Workshop 入口交付 CK3 Mod 与桌面 Runtime 所需文件，通过可发现的 Bootstrap 完成用户明确启动、hash 校验、安装、staging 更新与回滚。**必须先核验 Steam/CK3/Paradox Workshop 的当前格式、可执行文件政策、大小/许可/安全限制**。不能假设 CK3 Mod 可以静默运行 Windows EXE；若平台不允许 exe payload，应重新作符合规则的分发设计与用户体验 Gate，而不是规避限制。与 Three-Mod 独立工程无关。

<a id="source-850ece6044d9--79-v98有证据退役历史路径"></a>
### 7.9 V9.8：有证据退役历史路径

按 `Behavior Freeze → Adapter Boundary → Strangler Migration → Contract Verification → Decommission` 顺序执行。旧 Prompt 路径、Provider 特判、Memory 重复读取、旧 IPC、测试/文档等按引用证明退出；**保留 V8 存档、旧摘要、未收信件、Forget 记录、恢复快照和必要迁移工具**。历史文档归档而非直接销毁。

<a id="source-850ece6044d9--710-v99rcsoak完整冻结"></a>
### 7.10 V9.9：RC、Soak、完整冻结

停止新增大型功能。组合验证：完整下载/安装/更新/离线/回滚，双 Runtime 握手，真实 CK3 存档与多人互动，Memory4 权限，Letter/Action 的一次性真实确认，Provider 请求矩阵，英中 UI，第一轮与长期连续回合性能、复杂数据恢复。建议起点为真实 CK3 至少 2 小时与 100+ 回合，但阈值最终需以 V9.0 采样和设备能力定标，而非把建议写成已经测试。

---

<a id="source-850ece6044d9--8-跨版本风险优先级与阻断门槛"></a>
## 8. 跨版本风险优先级与阻断门槛

| 级别 | 风险 | 最低阻断规则 |
|---|---|---|
| P0 | Campaign／Owner 串档、Forget 复活、旧记忆/存档丢失、重复执行有副作用的 Effect | 任意出现即阻断对应合并／发布，保留数据并恢复安全路径 |
| P0 | 错误的 ACK/Letter 状态导致错误确认或未知效果重放 | 不得通过忽略日志或绕过幂等锁解决 |
| P1 | 冷启动前几轮重复 UI／游戏卡顿 | V9.0 必须有 trace 和验证修复，或在无法复现时保存可验证未复现说明与继续监测 Gate |
| P1 | CI 对指定 SHA 失败 | 不能宣称 `CI_PASS`；V9.0 Exit Gate 要求稳定绿灯 |
| P1 | 兼容工程迁移丢文件、测试或误删除本地安装 Mod | 先完整备份与独立仓库复验，后移除 VOCT 跟踪副本 |
| P1 | CK3 Bridge/Workshop 更新导致版本错配或用户数据覆盖 | 协议检查、manifest、备份与回滚是分发前置条件 |
| P2 | UI 翻译遗漏、历史文档死链、部分非生产测试过时 | 进入退役台账，V9.8/9.9 收口 |

<a id="source-850ece6044d9--性能防回归底线"></a>
### 性能防回归底线

- 在没有可比基线前，任何“速度提高 X%”均不得写为完成事实。
- 首次优化优先消除明确重复工作、无界扫描与主线程同步阻塞；不能减掉安全校验、隐私过滤或 ACK 等待来换取响应速度。
- 记录异常和可用性的同等 Gate：冷启动时不能用过时 Worldline、跨战役的记忆或不完整数据换掉 UI 卡顿。

---

<a id="source-850ece6044d9--9-v90-之后的主要依赖链"></a>
## 9. V9.0 之后的主要依赖链

```text
V8 冻结决策 + 实际 SHA/安装版核验
               │
               ▼
V9.0 三条前置流（可在隔离分支并行）
  ├─ CI 反例保留与远端 Gate 修复
  ├─ 冷启动/逐轮性能归因与最小修复
  └─ Three-Mod 工程独立迁移与校验
               │
               ▼
V9.0 合同/基线/文档 Exit Gate
               │
               ▼
V9.1 Source/Build ──► V9.2 JSON/Core ──► V9.3 Provider
                                            │
                                            ▼
V9.4 PromptPlan/Cache ──► V9.5 UI/i18n ──► V9.6 VOCT CK3 Bridge
                                            │
                                            ▼
V9.7 Workshop/Bootstrap ──► V9.8 Legacy Retirement ──► V9.9 RC/Freeze
```

每次提交必须交代：**基线 SHA、受影响代码与数据、修改范围／非范围、验证命令、人工待测项、回滚方法、证据级别**。每个危险入口均有独立正例和负例；不能把“测试脚本执行次数”当作唯一进度指标。

---

<a id="source-850ece6044d9--10-最终-v9-全阶段完成定义"></a>
## 10. 最终 V9 全阶段完成定义

1. **可重建**：正式源文件在干净环境构建出含完整资源的 Runtime，产物可校验。
2. **可维护**：Conversation、Memory、Provider、Worldline、Bridge、Persistence 的责任和对外 DTO 明确。
3. **可回忆**：Memory4 不泄露没有合法获得的记忆，叙事因果与跨年代的人物关系仍自然。
4. **可恢复**：JSON/Index/Finalization/Letter/RunFile 崩溃可重放或安全停机，不丢数据、不重做未知副作用。
5. **可测量**：启动阶段卡顿和长局 P50/P95 有证据；Remote CI、真实 Provider、CK3、打包 UI 结果各自可追踪。
6. **可调用**：主要 Provider 的正常／错误／流式／结构化能力稳定，缓存诊断可信。
7. **可使用**：中文和英文 UI 不破坏对话 Prompt 语言及主题阅读体验。
8. **可安装**：在平台允许且符合许可的前提下，Workshop 提供单一发行入口；升级/回滚保留用户数据。
9. **边界清晰**：Three-Mod 兼容工程可以独立维护与发版，VOCT 本体没有它也可工作；VOCT 自身 CK3 Bridge 仍被正确管理。
10. **可冻结**：P0/P1 = 0，P2 有明确接受／延期记录，完整 Gate 与发行回退成功。

---

<a id="source-850ece6044d9--11-证据链接与仍未核验的事项"></a>
## 11. 证据链接与仍未核验的事项

**本次实际审阅的仓库来源：**

- [当前 HEAD 提交](https://github.com/wsdsb-111/VOCT-NEW/commit/3c49364fb1f9d4f1a90c6c09df3cc3966a01b8c4)
- [最新失败的 GitHub Actions 工作流](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/38021500350)
- [Release Regression 工作流定义](https://github.com/wsdsb-111/VOCT-NEW/blob/main/.github/workflows/regression.yml)
- [历史版本 QA 脚本](https://github.com/wsdsb-111/VOCT-NEW/blob/main/scripts/test-v8.15.2-letter-archive-independent-qa.js)
- [V8.15.2 旧计时管道退役与实机改善记录](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/v8.15.2-letter-timer-retirement-report.md)
- [V8.15.2 日期增量扫描／停机回执修复](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/v8.15.2-fix5-implementation-report.md)
- [V8.15.2 空闲 RunFile 轮询与合法空操作](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/v8.15.2-idle-run-carrier-report.md)
- [V8.15.2 对话窗口外正式载体消费缺口](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/v8.15.2-outbound-bridge-followup-report.md)
- [Three-Mod 1.0.6 同级流官独立功能报告](https://github.com/wsdsb-111/VOCT-NEW/blob/main/docs/v8.15.2-celestial-same-tier-office-report.md)
- [当前测试清单](https://github.com/wsdsb-111/VOCT-NEW/blob/main/scripts/test-manifest.js)

**仍需现场/执行验证：** `V8 冻结 tag 是否存在`、当前本机 VOCT 二进制 SHA 与 HEAD 是否对应、Workshop 文件是否与记录快照相同、用户本次卡顿的具体现场 trace、迁出兼容工程的新仓库与 CI、V9.0 修改后的远端 CI 绿灯。凡未执行均保留 `NOT_VERIFIED`，不以计划文字冒充实际交付。

---

<a id="source-850ece6044d9--附录-av90-施工文档最低结构"></a>
## 附录 A：V9.0 施工文档最低结构

1. 实际 SHA／冻结证据／受影响安装文件版本；
2. 当前生产调用链及阶段计时位置；
3. In Scope / Out of Scope / 安全边界；
4. 性能实验、统计和反例矩阵；
5. 独立兼容工程迁移清单与回退；
6. CI 修复与历史版本基准资产；
7. Behavior Contracts、Data Ownership、Decommission Ledger；
8. 自动化、远端、打包、CK3、Provider 和 Soak Gate；
9. 明确的退出标准、结果文件和下一版移交单。

<a id="source-850ece6044d9--附录-b与旧路线的关键差异"></a>
## 附录 B：与旧路线的关键差异

| 旧路线 | 本次修订 |
|---|---|
| V9.0 仅收集架构与行为基线 | 把启动卡顿归因/必要修复、红 CI 收口、兼容工程剥离纳入 V9.0 硬门槛 |
| 基线 `0c290d8`（修复2） | 最新读到 `3c49364`（修复6），现场需再次核对 |
| Three-Mod 作为不得误删的外部目录保护项 | 明确 **迁出 VOCT 当前仓库**，独立测试/版本/CI，同时不得删除玩家本地安装工程 |
| V9.6/9.7 再整理 Mod 发行 | **V9.0 就解耦兼容项目；V9.6/9.7 仅纳管/分发 VOCT 自身 Bridge Mod** |
| 性能只是一般性 P50/P95 基线 | 加入 CK3 帧、Renderer、Main、Provider 和冷／暖逐轮 trace，防止“关掉循环就好了”的误修 |
| 本地发布检查可引用历史报告 | 新增最新远端 CI 已失败的可复现根因与修复 Gate |

> **路线总结**：V9.0 要先将 V8 的“功能冻结”变成**可执行、可验证、边界清楚且性能有证据的工程基线**，再进入 V9.1 及后续系统重构。此文档不代表任何 V9 工程变更已经实施。

<!-- chapter:source-850ece6044d9:end -->

<!-- chapter:source-7b709dd3a0b3:start -->
<a id="source-7b709dd3a0b3"></a>
## 来源：docs/current/v9/V9_VERSION_ALIGNMENT.md

原文规范化 SHA-256：`34b3e0036e77ec1efbef2e4c8e24a9bdd8dda70c3b742ec8eef348c834eac8ce`。

<a id="source-7b709dd3a0b3--v90-发行版本对齐"></a>
# V9.0 发行版本对齐

日期：2026-10-11。按用户后续要求统一代码、前端和当前维护文档；本地修改未提交、未推送。原始设计中的 App 2.0.4 和 V8 冻结版本是历史快照，本记录覆盖当前发行版本要求。

| 对象 | 当前版本 | 依据与展示 |
|---|---|---|
| 项目／核心 | V9.0／9.0 | `out/main/version.js`；窗口标题和前端功能标签 V9.0 |
| Electron App 包 | 9.0.0 | `resources/app/package.json`，采用 SemVer；沿既有 `app:getVersion` 读取，页脚提示 `VOTC App 9.0.0` |
| VOTC Workshop Mod | 2.0.5 | Workshop item 3346777360 的两份 descriptor；页脚 `V9.0 · Mod v2.0.5` |
| 人物记忆 | Memory Engine 4.0 | 保留玩家可见版本；持久化协议仍为 3.0 |
| 摘要存储 | 2.5／schemaVersion 2 | 保留兼容、字段、目录、召回顺序、缓存键和迁移边界 |
| Official Action | official-votc-2.0.3 | 保留正式动作基线 |
| 独立 Three-Mod 兼容工程 | 1.0.6 | 与 VOTC Workshop Mod 分别维护，本次不改官职规则或兼容工程版本 |

<a id="source-7b709dd3a0b3--改动范围"></a>
## 改动范围

App 包元数据、核心版本、Renderer 常量／页脚／页面标题、主题预览同步。Provider 现有三处自定义 User-Agent 使用包版本，三处 X-Title 使用核心版本；OpenRouter SDK 默认 User-Agent 保留，接口、请求体和 Provider 配置不改。App 自动更新仍关闭。

同步根目录／docs／scripts／主进程的 AGENTS.md、根 README、CHANGELOG、文档索引、摘要合同、外部运行依赖及当前 V9 架构／验证入口。归档测试、历史实施报告、原始设计和冻结哈希不回写。AGENTS 验证命令改为现行 `test-v7.10-official-action-system.js`，原 `test-action-system.js` 已属历史归档。

Workshop 内容路径：`D:/SteamLibrary/steamapps/workshop/content/1158310/3346777360/descriptor.mod`；启动器路径：`E:/Documents/Paradox Interactive/Crusader Kings III/mod/ugc_3346777360.mod`。两份仅更新 `version="2.0.5"`，名称 `Voices of the Court 2.0`、item ID、supported_version 和路径保留，避免破坏依赖与启用配置。版本标签不能代替 CK3 的实际加载版本检测，本次没有新增 App／Mod 握手。

VOTC.exe 二进制未重新打包，Windows 文件属性中的旧壳版本仍为 2.0.3／2.0.3.0；实际加载资源和 `app.getVersion()` 已为 9.0.0。正式重建发行包属于后续构建工作，不能把本次资源更新称为 EXE 文件属性重写或 Steam 发布。

<a id="source-7b709dd3a0b3--验证"></a>
## 验证

- `test-v8.14.1-frontend-content.js`：版本红测后转绿；检查 UI、包版本、主题预览和 Memory 4.0／协议 3.0／存储 2.5／schema 2。
- `test-v7.7.4-stability-infrastructure.js`、`test-v7.8-main-modularization.js`、`test-v7.10-official-action-system.js`、`test-v8.8.5-zhipu-provider.js`、Manifest 检查通过。缓存测试在沙盒 TEMP 曾失败，正常 Windows 环境重跑通过，未改缓存实现或断言。
- 默认关闭／显式开启诊断的真实隔离 VOTC.exe 两次启动均 PASS、exit 0；临时配置目录，CK3 未配置、网络阻断。读回窗口标题、包版本、页脚和提示均匹配上表；默认关闭截图人工检查版本完整可见。
- 当前发布清单为 478 个分类测试文件、409 个发布组、68 个历史归档。完整原始门禁首次及最终工作树复核均 **409/409 PASS、exit 0**；最终日志哈希、35 个生产／测试／当前文档指纹与两份 descriptor、七份未变桥文件登记于[本轮证据](../../current/v9/version-alignment-evidence.json)。
- 本轮源码语法及 `git diff --check` 通过。未改 Memory、摘要数据、Prompt／Cache、信件队列或官职脚本；本轮只核验两份 Workshop 元数据，不代替 CK3／Provider／远端 CI 验收。

实际截图与隔离诊断证据在本机 TEMP `votc-v9-performance-smoke-CTC0OD`；完整日志使用 `votc-v9-version-final-release-20261011.log`。日志、截图和运行时数据不纳入 Git。旧 [v9-local-evidence.json](../../current/v9/v9-local-evidence.json) 是版本对齐之前的工程证据，不作为当前工作树指纹。

V9.0 总体仍按[实施与验证](V9.0.md#source-7f8563a38eee)记录 HOLD：本地版本对齐完成，远端 CI、真实 CK3 对照和启动卡顿现场采样仍待完成。用户已验收的 V8 功能保持原状态。

<!-- chapter:source-7b709dd3a0b3:end -->

