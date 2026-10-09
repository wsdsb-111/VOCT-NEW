# VOTC 文档索引

本目录集中保存 VOTC 的架构说明、版本设计、实施报告和阶段记录。根目录的 [README.md](../README.md) 只负责项目简介、安装运行和当前基线；根目录的 [CHANGELOG.md](../CHANGELOG.md) 负责版本顺序，详细内容按下面的分类维护。

## 推荐阅读顺序

最新记忆修复：[V8.15.2 年度与人生获知日期归档](v8.15.2-derived-acquisition-hotfix-report.md)。长期来源事件日期未知时旧逻辑全部排除，按用户确认的获知年份归档并保留未知事件标注；记录派生/召回边界、独立 QA 与真实打包按钮证据，已有真实来源重建待本轮验收。

当前实机验收：[V8.15.2 用户确认记录](V8阶段开发记录.md#第一百七十六阶段v8152-用户实机验收补记2026-10-09)。2026-10-09 用户确认信件归档、退役后卡顿改善及日期/信件持续正常、年龄刷新、多人披露、跨 Provider、缓存遥测和长时间运行通过，并确认跨 NPC 对话未出现内容泄露。下方历次报告保留实施时快照。

最新信件运行合同：[V8.15.2 旧计时管道退役](v8.15.2-letter-timer-retirement-report.md)。关闭新旧并行的旧 GUI 循环、日期 rearm 和载体查询，保留正式日期/投递/接收归档。用户已确认退役后卡顿改善、日期和信件持续正常，长时间运行通过验收。

最新信件归档：[V8.15.2 信件投递后记忆归档热修](v8.15.2-letter-memory-receipt-hotfix-report.md)。用户已确认宝物/正文恢复及信件归档验收通过；本轮补齐精准游戏回执与冻结双方来源，失败只恢复记忆不重寄。已授权单封补建的操作时快照仍保留。

最新日期链路：[V8.15.2 独立日期桥与日志读取器热修](v8.15.2-native-clock-log-reader-hotfix-report.md)。实际 A2 日志已执行但 App 卡在监听重启、旧 TailFile 背压红测、新 reader 与全局原生时钟的实现及验收边界；前轮信件生命周期报告保留为未解决全部事故的历史证据。

最新信件修复：[V8.15.2 执行器生命周期热修](v8.15.2-letter-runner-lifecycle-hotfix-report.md)。写信父 widget 与子事件重建 runner 的冲突、官方 2.0.3 对照和红/绿 QA 证据；用户确认世界记忆当前日期保存通过，信件实机 Gate 继续单列。

最新日期修复：[V8.15.2 实时日期解析与信件启动](v8.15.2-live-date-producer-hotfix-report.md)。正式 init 字段误读、独立命名 on_action 追加及 rich DATE 持续日期桥接；真实 Worker/窗口证据和仍待实机的宝物/摘要验收分别记录。上轮报告保留为历史证据。

最新后续修复：[V8.15.2 隐私、信件日期与世界记忆](v8.15.2-privacy-letter-world-memory-followup-report.md)。记录头衔别名/远程地点红测、runner 自举与暂停恢复、同 epoch 物理载入隔离，以及五种范围保存和可见反馈。配套 Mod 文件/指纹沿方案 B 记录，实际事故证据与未复现部分分开，CK3/Provider Gate 待用户。

当前排查入口：[V8.15.2 陌生角色记忆越权防护修复](v8.15.2-stranger-memory-isolation-report.md)。知情索引与原始授权取交集，显式转述源头也复核授权，同名摘要按准确人物对及战役过滤，封堵非本人首都资料绕过。首轮官方追忆指纹证据、地点资料入口与其他未定案细节分开记录；真实 GLM / CK3 Gate 待用户。

前次热修入口：[V8.15.2 世界记忆保存与摘要日期排序](v8.15.2-world-memory-summary-date-hotfix-report.md)。保存期间的后台通知延后重读，不重试写入，跨分支拒绝继续保留；摘要仅重排显示，操作使用源索引。该阶段完整发布 387/387，隔离窗口及实机边界见报告。

当前修复入口：[V8.15.2 修复2：未来事实与年龄问答边界收口](v8.15.2-fix2-implementation-report.md)。日期型未来与将是/将为拒绝当前披露；真实玩家裸回答可被合法旁听者学习，隐藏 spoken 边界只传递消息 ID 并中止旧问答绑定。验证、最小元数据改动及 L21-L25 实机边界见报告，以下为前置版本快照。

当前修复入口：[V8.15.2 修复1：未来披露与多人年龄旁听](v8.15.2-fix1-implementation-report.md)。未来语句不能授权当前事实，具名年龄问答向真实听见双方发言的各 Owner 保存独立知识；未知目标、错误回答者、插话和不可见来源拒绝。验证与 L16-L20 实机边界见报告，以下为前置版本快照。

当前施工入口：[V8.15.2 可观察特质与人物披露实施报告](v8.15.2-implementation-report.md)。首轮前逐 Owner 直接观察、42 项可观察特质、Self 完整认知、年龄披露事故、动态事实和来源弹窗竞态；代码/窗口证据、独立 Mod 配套与实机 Gate 分别记录。以下为前置阶段快照。

本轮界面优化：[V8.15.1 三主题阅读与布局优化](v8.15.1-ui-comfort-implementation-report.md)。中文界面字体、低亮度阅读面、导航/记忆/世界书换行与窄面板布局；保留三主题图像、用户对话字号及全部运行时合同。打包窗口证据与人工边界见报告。

当前施工入口：[V8.15.1 世界线、记忆恢复与披露一致性实施报告](v8.15.1-implementation-report.md)。对应下方审查的 W1-W3、M1-M4，补齐公开头衔/特质的逐 Owner 保存；保留姓名绑定、Fact Epoch、持久遗忘及协议边界。验证证据与人工 Gate 以实施报告为准，下方审查结果为修复前快照。

当前只读审查：[V8.15 世界线与 Memory4 逐链路审查](v8.15-worldline-memory-detail-review.md)。核对实际 autosave、checkpoint、100 条长期记忆的文件完整性及生产接线，确认信仰/文化适配、恢复与派生、canonical-only 召回、详情缓存和关系空值共七项缺口；人物披露专项单列证据与待确认条件。本轮原始完整门禁 374/374 通过，但未修复生产代码或做 CK3/Provider/窗口/Soak 验收。

当前小修入口：[V8.15 修复1.1实施报告](v8.15-fix1.1-implementation-report.md)。补齐显式未拆分 Narrative 对非目标 Derived 的最终入选优先级，既有目标之间不强制覆盖；保留预算/授权边界，删除误留空文件。验证和 L9 新实机用例见报告。下方为前置阶段快照。

当前修复入口：[V8.15 修复1实施报告](v8.15-fix1-implementation-report.md)。显式人物的最终入选、预算裁剪与实际 Provider Input 联动验证；不确定遗忘 fail-closed，旧残留使用只读 Audit 与明确确认 Forget。报告包含诊断接口、共享来源保护和验收证据；不自动修改旧数据，不签发 Full Freeze。下方为前置阶段快照。

当前开发入口：[V8.15 Memory4 召回与删除一致性实施报告](v8.15-memory-recall-forget-implementation-report.md)。显式人物目标不受在场状态排除；删除按 Campaign/Owner/人物对持久遗忘并阻止恢复复活，Legacy 仅在证明完整覆盖时退役。独立生产 Prompt/重启夹具、完整门禁和隔离窗口证据集中在报告；协议 3.0、存储 2.5 保持兼容，真实 CK3/Provider/Soak 仍待用户 Gate。以下为前置版本与 Mod 排查快照。

本轮只读排查：[2026 年 10 月征召兵减少调查](v8.14.2-october-levy-mod-investigation-report.md)。三位 GPT-6 Luna Max 核查完整 45 项加载链；用户实机确认仅东方王朝的 1032 开局仍低兵，1066 宋征召兵恢复至 11111/11111。复现场景已收敛，早期建筑初始化为主要解释方向，未唯一定位代码故障；没有修改游戏、Mod 或存档，也未发布增兵补丁。

本轮最新入口：[V8.14.2 天朝制低级头衔任命热修](v8.14.2-celestial-succession-compatibility-hotfix-report.md)。Three-Mod 1.0.2 已安装；文武总督任命对王国级及以上封臣降级竞争额外扣 10000 分，原有 UI 兼容保留。专项、独立 QA、正常环境完整发布 367/367 通过，CK3 候选评分及继承 Gate 待用户。以下为先前阶段快照。

本轮最新入口：[V8.14.2 P0 第三人记忆召回热修](v8.14.2-third-party-memory-recall-hotfix-report.md)。当前轮提及范围扩至回应者可见的 NPC 发言，Memory4 合并玩家查询和 NPC 本轮实体；Legacy 姓名回退采用最长唯一 alias 匹配。40 组专项及当前轮/代词 TTL 回归通过；完整发布门禁在首组临时原子重命名处报 EPERM。以下为先前阶段快照。

前次入口：[V8.14.2 修复4实施报告](v8.14.2-fix4-implementation-report.md) / [第一百五十四阶段](V8阶段开发记录.md#第一百五十四阶段v8142-修复4收口)。动作型直接引语采用 identity-first speaker provenance，第三人/歧义归属 fail-closed；完整发布 367/367、独立 QA 与隔离 UI 38 张截图通过。CK3 L1-L4、真实 Provider/cache telemetry/Soak 待用户 Gate，不签发 Full Freeze。以下为先前阶段快照。

前次入口：[V8.14.2 收口修复](v8.14.2-closeout-fix-implementation-report.md) / [App 与 Mod 外部运行依赖](EXTERNAL_RUNTIME_DEPENDENCIES.md)。第三人直接对白、唯一昵称绑定、Fact Epoch 防旧认知复活已接通；完整发布 367/367、独立 QA、隔离 UI 38 张截图通过，清单 367 发布组、436 分类文件、68 历史归档。真实 CK3/Provider/cache telemetry/Soak 待用户 Gate，不签发 Full Freeze。以下为先前阶段快照。

前次入口：[V8.14.2 信件调度与记忆重试热修](v8.14.2-letter-memory-retry-hotfix-report.md)。接受后信件摘要、Detail/Year/Life 和失败重试独立于游戏 Effect；模型整理联动重建并保留手工版本。该阶段清单 363 发布组、432 分类文件、68 历史归档。

最新入口：[V8.14.2 姓名、关系上下文与人物披露热修](v8.14.2-entity-naming-disclosure-hotfix-report.md) / [第一百五十阶段](V8阶段开发记录.md#第一百五十阶段v8142-姓名关系上下文与人物披露热修2026-10-05)。接入已有 Owner 关系与来源姓名、原话披露及历史年龄/日期；用户确认长期记忆生成 PASS。完整发布 359/359、独立 QA 14/14、隔离窗口 38 张截图通过；清单 428 分类文件、359 发布组、68 历史归档。既有数据不自动重写，本次新改动的 Provider/CK3/Soak Gate 仍待用户验收。下方为先前阶段快照。

最新事故入口：[V8.14.2 摘要编辑与长期记忆热修](v8.14.2-summary-memory-incident-hotfix-report.md)。普通 Legacy 编辑不再误受 Memory4 归档只读限制；长期抽取补齐已证明知情的 Owner 实体授权，全部候选校验失败保留恢复快照，不再冒充无长期事实。完整发布 355/355、独立 QA 8/8、隔离窗口 36 张截图与普通摘要实际保存通过；清单为 424 分类文件、355 发布组、68 历史归档。真实 Provider/CK3 生成仍交用户复测，旧数据不自动回填。下方 Disclosure 结果为热修前的阶段快照。

当前入口：[V8.14.2 Owner-scoped Disclosure 实施报告](v8.14.2-owner-scoped-disclosure-implementation-report.md) / [第一百四十八阶段记录](V8阶段开发记录.md#第一百四十八阶段v8142-owner-scoped-disclosure)。披露按 Campaign × Owner × Entity × Fact 限定，接入 Memory4 Known Entity、对话 Finalization、收信/回信 Gate 与人物认知 UI。清单为 421 个分类测试文件、352 个发布组、68 个历史归档；最终完整发布门禁 352/352。独立 adversarial QA 31 PASS/0 FAIL，隔离 UI Smoke 34 张截图、startup smoke 36/36 通过。Disclosure CK3/Provider/cacheTelemetry/Soak Gate 仍待用户实测，不宣称 Full Freeze。

[V8.14.1 前端内容同步](v8.14.1-frontend-content-update-implementation-report.md)保留当时的 Memory4 策略、协议 3.0/存储 2.5 和 App 版本证据。前次实机事故报告记载的信件 `NOT TESTED` 是报告形成时的状态；用户随后确认完整信件往返实机 PASS，详见 V8.14.2 报告，不回写历史报告。

[前次实机事故热修报告](v8.14.1-runtime-incident-hotfix-report.md)保留日期/特质提示框兼容补丁部署、Memory4 归档生命周期 10/10 和当时 346/346 门禁；该报告形成时信件为 `NOT TESTED`，用户随后确认完整信件往返实机 PASS，详见 V8.14.2。新热修、真实 Provider 与 Soak 仍待用户实测。GLM Cache A/B 延至 V8.14.2，不标记 Freeze Candidate；[前次改进收口](v8.14.1-improvement-closeout-implementation-report.md)的 344 组属于更早历史证据。

前一阶段入口：[V8.14-D/E Year/Life 与长期记忆管理施工记录](v8.14-de-year-life-management-implementation-report.md)。该报告中的 339/339 组、408 分类文件为 D/E 当时快照，不被后续回归重写；A/B 用户确认与 D/E 隔离 UI 结果仍按原证据边界记录。

最新事故修复：[第一百三十七阶段：信件接收失联与时间召回](V8阶段开发记录.md#第一百三十七阶段信件接收失联与时间召回事故修复2026-10-01实机待验收)。信件新增完整日志载荷接收并修正通知时机及多行解析；时间查询保留冻结 Recent2，以动态 Extra 注入目标摘要，并支持有正文依据的首次相识线索。334/334 本地发布组及隔离 Electron 启动/导航通过，需重启 CK3/VOTC 实机复测；A/B 仍 HOLD。

当前优先阅读：[V8.14 二人/多人摘要生成与失败恢复可靠性修复](V8阶段开发记录.md#第一百三十四阶段v814-二人多人摘要生成与失败恢复可靠性修复实机待验收)，以及 [V8.14-B 实机事故修复与 A/B Gate 重开](v8.14-b-hotfix-incident-repair-report.md)。本轮按 V8.13.2.1 对比后移除了 V8.14 可见性源文修复成功后仍强制追加模型请求的门槛；恢复流程复用已保存输出，但必须重新通过来源、Presence 和可见性校验。逐篇摘要模型整理仍只以当前已保存正文为输入，不恢复原始对话。A/B 状态仍为 HOLD，Campaign 实机输出和真实 Provider 生成/恢复可靠性仍待实机验证。

V8.14 三大 Mod 称谓兼容补丁：[施工与验证记录](v8.14-three-mod-character-name-compatibility-report.md)。补丁以天家宗仪现有称谓分派为主，保留汉番专属分支，并将普通回退接入东方王朝命名；VOCT 的 `VOTC:IN` 读取字段未变。需在 CK3 启用补丁后实机验收。

V8.14 施工中：[工程化施工标准](v8.14-memory-engine-4.0-implementation-spec-dual-model.md) / [A 阶段实施报告](v8.14-a-durable-core-implementation-report.md) / [Sol 独立审查及修复复测](v8.14-a-sol-independent-review.md) / [Finalization 可见性收口及 P0 修复](v8.14-a-finalization-visibility-closeout-report.md) / [B Profile 与 CK3 回读接线](v8.14-b-profile-implementation-report.md) / [总体设计 Revision 3](v8.14-memory-engine-4.0-overall-design-revision3.md)。B 已接入生产 debug.log 回读，尚未接入旧摘要、实时 Prompt 或正式 Memory4 Recall；334 组发布回归通过，A/B 实机及独立 Gate 未验收。

V8.13.2.2 当前入口：[Legacy Bulk Campaign Binding 实施报告](v8.13.2.2-legacy-bulk-campaign-binding-implementation-report.md) / [阶段记录](V8阶段开发记录.md#第一百一十九阶段v81322-legacy-bulk-campaign-binding)。摘要管理器新增对话文件与 Owner 目录两级 Preview→确认→原子批量迁移；绑定等待当前会话 GameData 解析后再校验，只绑定未归属的普通旧摘要，不覆盖 Campaign Token 或官方追忆；stale revision 零写入，刷新当前 Recall 且 Frozen Prefix 不变。322/322 本地发布组通过；打包窗口、CK3/Provider 与远端 CI 仍待验收。

V8.13.2.1：[Acceptance Hotfix](V8阶段开发记录.md#第一百一十八阶段v81321-acceptance-hotfix)。321/321 本地发布组通过；多人时间召回按实际提问者保底；摘要管理器支持逐篇确认旧摘要 Campaign 绑定；原始摘要目录统计拒绝数；终局恢复后重试迁移；Coverage Patch 对预算截断显式标记部分事实。CK3/Provider 实机 Gate 待验收。

V8.13.2 当前入口：[Temporal Recall & Worldline Coverage Closure](V8阶段开发记录.md#第一百一十七阶段v8132-temporal-recall--worldline-coverage-closure)。修复 Legacy Campaign 唯一证据迁移、MEMORY_RECALL 双轴/直接对话保底、时间诊断、Broad Lane 完整性、CHARACTER_OVERVIEW 及补丁缓存修订。320/320 本地发布组通过；CK3/Provider Gate 待实测。

V8.13.1 当前入口：[Frozen Worldline Coverage 补强](V8阶段开发记录.md#第一百一十六阶段v8131-frozen-worldline-coverage)。冻结世界线补齐领域多样性，以不入 Prompt 的覆盖清单判断 CURRENT/UNSPECIFIED 缺口；动态补丁不进入缓存前缀，CK3/Provider 实机 Gate 仍待验收。

V8.13 当前入口：[会话冻结前缀与动态尾部实施记录](V8阶段开发记录.md#第一百一十五阶段v813-会话冻结前缀与动态尾部)。已选的候场 NPC 也在开场预取其个人世界线视图；所有 Chat Provider 共用 V8.13 缓存边界，317/317 本地发布组通过，打包 Electron 冒烟受本机 GPU 子进程错误阻断，CK3/Provider 缓存命中率仍待验收。

V8.12.1 当前入口：[双时间记忆及 V8.12.1.2 遗留问题修复实施记录](v8.12.1-dual-temporal-memory-implementation-report.md)。用户于 **2026-09-24** 确认 Part 3 实机 Gates 验收通过（用户报告）；V8.12.1.2 已完成本地代码与 316/316 自动发布 Gate，远端 Windows CI 和 CK3/Provider 实机 Gate 待验收，本机隔离 Electron 冒烟此前受 GPU 启动故障阻断、本次未重试。Part 3 通过不等于 V8.12.1 已验收或全局 V8 Full Freeze。

V8.12 基线入口：[Part 3 Memory Engine 3.0 施工与验收记录](v8.12-part3-memory-engine-3.0-implementation-report.md) / [第二部分历史检索与时间线实施报告](v8.12-part2-implementation-report.md) / [第一部分安全收口与 Temporal Archive 实施报告](v8.12-part1-implementation-report.md) / [Part 3 NPC Memory 存储结构前置分析](v8.12-part3-npc-memory-storage-analysis.md)。第一部分、Part 2 及 Part 3 前置验收的既有用户确认记录保留；施工时的自动化和隔离冒烟不重新分类为实机证据。原生官方追忆已走人物摘要与共享预算，存档 Shadow 保留只读诊断。下列为前置版本记录。

Part 3 前置的对话上下文/摘要可靠性工程见 [摘要系统合同与实机 Gate](README_摘要系统.md#v812-part-3-前置对话上下文与摘要可靠性待实机-gate) 及 [V8 阶段开发记录](V8阶段开发记录.md)。前置验收由用户确认，详细实机指标未回填；Part 3 本体状态单独记录于上述施工报告。

V8.11.1 当前入口：[一致性与知情边界实施记录](v8.11.1-consistency-implementation-report.md)。修复实时配偶授权、多人物观察、摘要编辑双轨一致性与 Legacy 删除映射；Self Current Truth、显式当前年份查询和动态全名补齐。非标准战争仅增加遗漏诊断。305/305 发布组和隔离 Electron 冒烟通过；真实 CK3/GLM/长期 Gate 仍待验收。

V8.11 当前入口：[世界事实召回与知情边界设计](VOTC_v8.11_世界事实召回与知情边界设计.md) / [V8 阶段开发记录](V8阶段开发记录.md)。补齐活跃战争候选、动态国号、两方领国知情和明确的日期/攻守语义；行踪按亲友或直接观察授权，历史资料不再覆盖此局人物生死与去向。新增内容全部沿既有 Worldline 动态尾部接入。303/303 发布组、372 个测试文件分类与隔离 Electron 冒烟通过；实际 CK3/Provider 回答、地点本地化覆盖与 Soak 不据此宣称完成。

V8.10.2 当前入口：[V8 阶段开发记录](V8阶段开发记录.md)。先修复摘要删除只清可见文件、Structured Memory 与 Recovery/RAM 缓存残留的 P0，再将 GLM Prompt 升级为 Cache v2 生命周期布局：只把 Global、Conversation Frozen、Responder Frozen 与稳定血亲放在缓存边界前，Memory、Worldline、实时状态、社会关系、场景和历史全部后移。302/302 发布组与隔离 Electron 诊断页导航通过；真实 GLM 连续轮次命中率、CK3 删除后失忆和长时 Soak 仍待人工验收。

V8.9.1 后续当前入口：[真实 Request Diff 实施报告](real-request-diff-implementation-report.md)。此前 Synthetic GLM 缓存路径诊断已完成并移除；诊断页自动捕获真实 Chat 请求，提供 Route、Conversation、Responder Scoped Prefix、消息/Block/Chunk Diff、有效参数与 Endpoint Diff、Provider Alignment、Prefix/时间桶、同 NPC/换 NPC 聚合和脱敏导出。真实 GLM/DeepSeek、CK3、RP 与 Soak 尚待人工运行。

V8.9 当前入口：[主对话多模型缓存实施报告](v8.9-chat-cache-implementation-report.md)。正式聊天 Prompt 升级为 v6 稳定前缀/动态尾部布局，保留 v5 一键回退；Family Facts 仅调整位置，不修改事实构造和亲属语义。后续 Real Request Diff 继续只观察真实 Chat，不改变 Action/Summary 选择或 Provider 路由。Runtime Profile Split 默认关闭并延期到后续阶段。

V8.8.5 当前入口：[审查问题与扩展亲属改进报告](v8.8.5-review-kinship-implementation-report.md)。后续 V8.9 诊断迭代已将其中旧的连接/缓存/clear_thinking/双模型按钮替换为真实 Request Diff；其余动作、亲属、流式 usage 和摘要边界保持不变。

V8.8.4 当前入口：[关系与动作事故修复报告](v8.8.4-incident-implementation-report.md)。包括真实旧人物脚本兼容、旧队列隔离、NPC/玩家 Scope 绑定、游戏侧重复执行保护、命令内金币与好感度回读。290/290 发布组及隔离 Electron 冒烟通过；用户已确认关系识别，最新动作补丁仍待 CK3 验收。下方 V8.8.3 记录属于前置历史基线，不能代表本次实机事故已通过。

V8.8.3 当前入口：[Sol 最终正确性审查](v8.8.3-sol-final-review.md)与 [V8 阶段记录](V8阶段开发记录.md)。金币不再乐观修改本地状态；同一 RunFile 在 Effect 后输出双方实时金币并写 ACK，只有回读精确匹配才进入 `CONFIRMED`。在场关系、被提及人物与 Family Fact 共享 Current Truth DTO，canonical Runtime 性别优先，缺失/冲突使用中性称谓。代码侧 289/289 发布组通过，Final Freeze 等待真实 CK3 人工 Gate。

V8.8.2 当前入口：[亲属关系正确性闭环](v8.8.2-correctness-closure.md)。长幼关系按 Anchor 出生日比较，出生日缺失/并列、性别冲突、Anchor/Target 未解析和来源截断均 fail-closed；多重角色按查询关系限定，Definition↔Runtime 强制双向一对一。配偶热修让 `edge.from` 人物自身生死决定已故语义，并拆分现任、前任与已故配偶 Intent；已故前配偶仍保留前配偶类型，不混入亡配偶查询。Prompt Order 不再依赖换行格式，Windows CI 支持手动触发。281/281 本地发布组通过；远端 Actions、真实 CK3/Provider 十问矩阵、100 次对话与 2 小时 Soak 尚待完成，因此仍为 `PENDING STAGE 8 MANUAL GATES`。

V8.7.2 当前基线：[Terra 实施报告](v8.7.2-terra-implementation-report.md)、[Luna 实施报告](v8.7.2-luna-implementation-report.md)与 [Sol 最终正确性审查](v8.7.2-sol-final-review.md)已完成；Load Session、Legacy 迁移原子性/ACL、双重召回、默认页性能边界、DeepSeek 模型选项、历史人物普通入口清理、世界记忆输入稳定性 P0 与 CK3 中文日期链热修已收口，249/249 发布组通过。真实 CK3、Provider 与打包 Electron Gate 待执行，当前为 `PENDING MANUAL GATES`。

V8.7 主体开发：[实施记录](v8.7-implementation-report.md)，存储—IPC—编辑器—正式对话已接通，204 组发布回归通过；浏览器交互验证通过，真实 CK3/Provider/打包 Electron 与最终 Freeze 待验收。

V8.7.1：[Terra 后端实施报告](v8.7.1-terra-implementation-report.md)、[Luna UI 实施报告](v8.7.1-luna-implementation-report.md)与 [Sol 最终正确性审查](v8.7.1-sol-final-review.md)已完成；分支、结构化 Current Truth、Secret/ACL、时间、Memory/Cache、Canon Test 与玩家处理界面通过 232 组发布门禁，代码侧 P0/P1 为 0；真实 CK3、Provider 与打包 Electron Gate 待执行，当前为 `PENDING MANUAL GATES`。

最新前置修复：[V8.7.0a 实施记录](v8.7.0a-implementation-report.md)，200 组发布回归通过，主体开发前暂停，实机验证待执行。

V8.6.2 历史入口：[Sol 实施与最终审查](v8.6.2-sol-implementation-and-final-review.md)。Subjective World 输出、第三人 Grounding、Kinship、Death/Temporal 与缓存/Token 边界已完成，38 个专项和 187 组发布门禁通过；真实 CK3、Provider、Production A/B 与 Electron UI Gate 未执行，`V8.6.2 FREEZE = PENDING MANUAL GATES`。

当前事故入口：[V8.5.1 摘要 P0 / 多人入场 P2 修复报告](v8.5.1-summary-incident-review.md)：摘要链路审计、长会话恢复、参与者隔离与入场延迟。

V8.5.2 当前施工入口：[Sol Stage 5 UI / DTO 边界审查](v8.5.2-sol-ui-boundary-review.md)；新旧 DTO 聚合矛盾、来源优先级和 Renderer 降级 raw 泄漏已修复，逐实体 UI 与 50 条边界保持通过，完整发布回归为 120/120。下一步 Astra Stage 6 最终集成与实机 Gate；`INTERNAL FREEZE = NOT READY`。

V8.5.1 历史基线：[Sol 最终审查与修复](v8.5.1-sol-final-review.md)，保留当时 109 组自动回归、15 人真实存档定义召回及未验收边界。

1. [项目 README](../README.md)：运行环境、配置方式和当前版本基线。
2. [CHANGELOG.md](../CHANGELOG.md)：按版本查看变更入口和对应的详细文档。
3. [V8阶段开发记录.md](V8阶段开发记录.md)：V8 Dynamic Historical Worldline System 的连续开发、冻结边界与验收记录。
4. [v8.4 GameState 能力勘探报告](v8.4-gamestate-capability-report.md)：CK3 Save 容器、Gamestate、人物/头衔/战争字段和停止边界。
5. [v8.4 性能基准](v8.4-gamestate-performance-benchmark.md)：指定 `autosave_1.ck3` 的读取、扫描、Query、索引和内存检查点。
6. [v8.4 Historical Definition ID 报告](v8.4-historical-definition-id-report.md)：历史源定义键、Runtime ID、`character_lookup` 与当前不确定性。
7. [v8.4 Mod 历史人物源报告](v8.4-modded-historical-character-source-report.md)：当前 active playset、岳飞/辛弃疾源文件和同名候选。
8. [v8.4 Historical ID UI/Debug 报告](v8.4-historical-id-ui-source-report.md)：CK3 `GetHistoryId`、debug.log 与 VOTC probe 边界。
9. [v8.4 Luna 实机 Date/History ID 验证](v8.4-live-date-historyid-validation.md)：CK3 运行时日期、岳飞 Historical ID 和普通角色空值对照。
10. [v8.4 Luna + Terra S0/S1 差分报告](v8.4-s0-s1-checkpoint-diff-report.md)：人物、Title、War、死亡、出生和历史人物 checkpoint 差分。
11. [v8.4 Luna + Terra 年度 Delta 对账矩阵](v8.4-annual-delta-reconciliation-matrix.md)：已确认项、部分可重建项与 Supplemental 边界。
12. [v8.4 Terra Definition Override 验证](v8.4-definition-override-validation.md)：当前 active playset 的重复源、Gamestate 证据和保守覆盖结论。
13. [v8.4 Sol 最终冻结审查](v8.4-final-freeze-readiness-review.md)：Test 1–6 最终 Gate、P0 阻断项和可冻结架构结论。
14. [v8.4 Terra 世界线运行时实施](v8.4-terra-worldline-runtime-implementation-report.md)：Save Reader、Worker、Checkpoint、Delta、IPC 和默认关闭的世界知识 Prompt 基础。
15. [v8.4 Luna 世界线前端实施](v8.4-luna-worldline-frontend-implementation-report.md)：世界线页面、检查点展示、Supplemental 编辑器和 Terra IPC 接入。
16. [v8.4.1 Luna UI 实施报告](v8.4.1-luna-ui-implementation-report.md)：Localization 证据展示、语义化世界概览、长字段和复制入口。
17. [v8.4.1 Terra Query/Freshness 实施报告](v8.4.1-terra-query-freshness-implementation-report.md)：中文实体分析、Localization 反查、as-of 与 STALE Prompt Gate。
18. [v8.4.1 Luna Prompt Diagnostics 实施报告](v8.4.1-luna-prompt-diagnostics-implementation-report.md)：只读 Query / World Recall 诊断、Token 分块、Cache Hit 与裁剪项。
19. [v8.4.1 Sol-3 Prompt Source Boundary Review](v8.4.1-sol-3-prompt-source-boundary-review.md)：中文 Live 日期兼容、Checkpoint as-of 与 Prompt 来源优先级审查。
20. [v8.4.1 Hotfix Luna 实施报告](v8.4.1-hotfix-luna-implementation-report.md)：Token Breakdown 专用渲染、总和校验和 Resolver 诊断区域。
21. [v8.4.1 Hotfix Terra 实施报告](v8.4.1-hotfix-terra-implementation-report.md)：中文 Localization 回退、扫描状态、Historical Alias→Runtime 闭环与真实 Checkpoint Gate。
22. [v8.4.1 Hotfix Sol 最终审查](v8.4.1-hotfix-sol-final-review.md)：真实六查询矩阵、Alias/Source/UI 边界和最终自动化 Gate。
23. [v8.4.2 Luna UI 前置层实施报告](v8.4.2-luna-ui-implementation-report.md)：身份候选与 Game Truth 隔离、历史定义绑定语义、年度 Delta actor/来源展示和 Checkpoint-only 新鲜度。
24. [V8.4.2 Run Command 生命周期热修实施报告](v8.4.2-run-command-lifecycle-hotfix-implementation-report.md)：Conversation Close 世代/TTL、Run Command Queue v3、启动恢复、carrier 隔离和 ACK 超时安全边界。
25. [V8.5 Luna 玩家语义展示层实施报告](v8.5-luna-player-semantic-ui-implementation-report.md)：默认玩家视图、语义映射和高级诊断。
26. [V8.5 Terra Retrieval 2.0 实施报告](v8.5-terra-retrieval-implementation-report.md)：确定性 Query Planner、Retriever/Ranker、DTO、缓存 revision 与 Prompt token 预算。
27. [V8.5.1 Terra Historical Definition Index 实施报告](v8.5.1-historical-definition-index-terra-implementation-report.md)：后台通用姓名索引、身份门禁、coverage 与 100 条确定性矩阵。
28. [V8.5.1 Luna 历史人物诊断可读性实施报告](v8.5.1-luna-historical-diagnostic-ui-implementation-report.md)：玩家摘要、可读判定依据、来源完整性/索引未命中状态和开发者追踪分层。
29. [V8.5.2 Terra Runtime Identity 实施报告](v8.5.2-terra-runtime-identity-implementation-report.md)：Runtime-native、世界线差异、复姓/长姓名来源和 Mapping 安全显示。
30. [V8.5.2 Sol 后端正确性独立审查](v8.5.2-sol-correctness-review.md)：False Resolution 矩阵、DTO/IPC 边界、截断与 coverage 安全修复。
31. [V8.5.2 Luna 玩家语义与世界线差异 UI](v8.5.2-luna-ui-implementation-report.md)：逐实体身份、差异面板、Mapping 玩家层和多分辨率/主题视觉回归边界。
32. [V8.5.2 Sol UI / DTO 边界独立审查](v8.5.2-sol-ui-boundary-review.md)：additive/legacy 摘要一致性、SOURCE_INCOMPLETE 优先级、A/B/C 层泄漏和有界渲染复核。
33. [V8.8 Luna Entity & Kinship Inspector](v8.8-luna-implementation-report.md)：身份/状态/关系/差异四栏、同名候选、关系歧义、已故状态、Relation Path、历史身份页和 raw enum 隔离。
34. [V8.8 Sol 静态架构与安全审查](v8.8-sol-static-safety-review.md)：大存档白屏性能修复、关系/身份正确性、Secret/Memory/Cache 边界、真实存档隔离 Electron 证据和未冻结项。
35. [V8.8.1 第三方亲属关系锚点](v8.8.1-implementation-report.md)：第三方 Anchor、自然中文关系意图、性别 fail-closed、子女 alias、诊断与自动化证据。
36. [V8.8 UI 主题背景补充](v8.8-ui-theme-backgrounds.md)：游牧、骑士、水墨三套背景映射、控件可读性覆盖层与验证结果。
37. [V8.8.2 亲属关系正确性闭环](v8.8.2-correctness-closure.md)：长幼参照、性别冲突、多重角色、身份一对一、配偶三状态、已故配偶方向、生产/运行时缓存、截断与来源完整性修复及门禁。
38. [README_摘要系统.md](README_摘要系统.md)：Memory Engine 4.0 可见标签、3.0 协议、2.5 存储合同、Owner-scoped Disclosure、冻结召回与生命周期规则。
39. [V7阶段优化记录.md](V7阶段优化记录.md)：V7/V7.x 的连续阶段记录。
40. [V6阶段优化记录.md](V6阶段优化记录.md)：V6.2 至当前 V6.x 的动作系统和基础设施记录。
41. 需要核对具体方案时，再阅读版本设计文档和实施报告。

## 文档分类

最新阶段：[V8.12.1 双时间记忆实施记录](v8.12.1-dual-temporal-memory-implementation-report.md)（自动 Gate 通过，实机待验收）。[V8.12 Part 3 NPC Memory 存储结构前置分析](v8.12-part3-npc-memory-storage-analysis.md) 保留为历史分析；Part 3 的实施与 2026-09-24 用户报告验收见 [Part 3 施工记录](v8.12-part3-memory-engine-3.0-implementation-report.md)，不将前置分析改写为实现或验收证据。

### 架构与运行规则

- [v8.9-chat-cache-implementation-report.md](v8.9-chat-cache-implementation-report.md)：V8.9 Prompt v6 顺序、v5 回退、Outbound 指纹、缓存证据、TTFT、双模型预设、隔离边界与人工 Gate。
- [real-request-diff-implementation-report.md](real-request-diff-implementation-report.md)：真实 Chat Request Diff、Conversation/Responder Scoped Prefix、Provider Alignment、Prefix/时间桶、同 NPC/换 NPC 聚合、脱敏导出和人工 Gate。
- [v8.8-stage0-sol-contract-audit.md](v8.8-stage0-sol-contract-audit.md)：V8.8 Historical Identity、Runtime Identity、Kinship、Current State 四层合同，P0/P1 复现证据和 Terra Stage 1—4 验收顺序。
- [v8.8-terra-stage1-4-implementation.md](v8.8-terra-stage1-4-implementation.md)：V8.8 Runtime 同名、Historical Binding、称谓解析、Family Entity Fact Bundle、P0 修复与自动化验证。
- [v8.8-luna-implementation-report.md](v8.8-luna-implementation-report.md)：V8.8 Entity & Kinship Inspector 四栏、关系路径、同名/已故状态、历史身份页和 raw enum 隔离。
- [v8.8-sol-static-safety-review.md](v8.8-sol-static-safety-review.md)：V8.8 Sol 大存档性能、身份/亲属正确性、Secret/Memory/Cache 边界审查与真实存档隔离 Electron 结果。
- [v8.8-terra-stage6-decommission-and-integrity.md](v8.8-terra-stage6-decommission-and-integrity.md)：V8.3 Shadow 链路退役、显式亲属类型、完整性扫描和 Checkpoint/branch 缓存边界。
- [v8.8-sol-final-code-review.md](v8.8-sol-final-code-review.md)：最终代码审查、生死/性别旁路修复、全量回归、隔离 Electron 证据与 Stage 8 人工冻结边界。
- [v8.8.1-implementation-report.md](v8.8.1-implementation-report.md)：第三方亲属 Anchor、自然中文关系意图、性别 fail-closed、子女 alias、诊断和自动化/实机边界。
- [v8.8.2-correctness-closure.md](v8.8.2-correctness-closure.md)：亲属长幼、性别冲突、多重角色、绑定一对一、已故前配偶隔离、CI 换行兼容、截断与来源完整性正确性闭环。
- [V8阶段开发记录.md](V8阶段开发记录.md)：V8.0 起的 Historical Baseline、Temporal Gate 与后续世界线阶段记录。
- [v8.12-part2-implementation-report.md](v8.12-part2-implementation-report.md)：第二部分 AS_OF/RANGE、历史时间线、WarActor、知情边界、Dynamic Tail 与两阶段实机 Gate。
- [v8.4-gamestate-capability-report.md](v8.4-gamestate-capability-report.md)：V8.4 CK3 Save/GameState 前置勘探总览；仅报告能力，不代表正式 V8.4 已实现。
- [v8.4-ck3-save-container-report.md](v8.4-ck3-save-container-report.md)：`SAV0100` 容器、metadata、Gamestate 提取和存档轮换观察。
- [v8.4-gamestate-schema-notes.md](v8.4-gamestate-schema-notes.md)：顶层 section、Character、Title、War 和历史人物解析字段笔记。
- [v8.4-gamestate-adapter-index-proposal.md](v8.4-gamestate-adapter-index-proposal.md)：后续 adapter、worker、normalized snapshot 和 bounded index 提案。
- [v8.4-live-probe-delta-hook-feasibility.md](v8.4-live-probe-delta-hook-feasibility.md)：Workshop debug probe、live date 和 delta hook 可行性。
- [v8.4-historical-definition-id-report.md](v8.4-historical-definition-id-report.md)：Definition ID、Historical ID 与 Runtime ID 的证据和稳定性边界。
- [v8.4-definition-runtime-mapping-report.md](v8.4-definition-runtime-mapping-report.md)：`character_lookup` 精确映射、控制组和全 Gamestate 数字反向搜索。
- [v8.4-modded-historical-character-source-report.md](v8.4-modded-historical-character-source-report.md)：当前启用 Mod 的历史人物源和同名冲突。
- [v8.4-historical-id-ui-source-report.md](v8.4-historical-id-ui-source-report.md)：CK3 UI/Debug getter、日志和 VOTC 临时 probe 可行性。
- [v8.4-historical-definition-catalog-proposal.md](v8.4-historical-definition-catalog-proposal.md)：只读 Definition Catalog 原型与正式 adapter 前置 Gate。
- [v8.4-live-date-historyid-validation.md](v8.4-live-date-historyid-validation.md)：Luna 实机 Live Date、Historical ID 和闭环证据。
- [v8.4-s0-s1-checkpoint-diff-report.md](v8.4-s0-s1-checkpoint-diff-report.md)：Luna + Terra S0/S1 人物、Title 与 War checkpoint 差分。
- [v8.4-annual-delta-reconciliation-matrix.md](v8.4-annual-delta-reconciliation-matrix.md)：Luna + Terra 年度 Delta 对账矩阵。
- [v8.4-definition-override-validation.md](v8.4-definition-override-validation.md)：Terra 重复 Definition ID、active playset 与覆盖结论。
- [v8.4-final-freeze-readiness-review.md](v8.4-final-freeze-readiness-review.md)：Sol 对 Test 1–6 的最终 Gate、冻结边界与补证路径。
- [v8.4-luna-worldline-frontend-implementation-report.md](v8.4-luna-worldline-frontend-implementation-report.md)：V8.4 Luna 世界线前端、Supplemental 编辑器和 Terra IPC 边界。
- [v8.4-terra-worldline-runtime-implementation-report.md](v8.4-terra-worldline-runtime-implementation-report.md)：V8.4 Terra Save Reader、Worker、Checkpoint、Delta、IPC 与 Prompt 基础的已实现行为和 Gate。
- [v8.4-sol-implementation-freeze-review.md](v8.4-sol-implementation-freeze-review.md)：V8.4 Sol P0/P1 审计、真实 autosave Service Gate、前端自动发现/状态事件管线及 Full Freeze 未放行项。
- [v8.4.1-terra-phase-a-implementation-report.md](v8.4.1-terra-phase-a-implementation-report.md)：V8.4.1 Terra Phase A 的 source revision race 防护、Political Context Resolver 与 Sol-1 交接边界。
- [v8.4.1-sol-1-p0-correctness-review.md](v8.4.1-sol-1-p0-correctness-review.md)：V8.4.1 Sol-1 对 source race、政治证据链、UNKNOWN 与 identity 边界的独立 P0 Gate。
- [v8.4.1-terra-localization-implementation-report.md](v8.4.1-terra-localization-implementation-report.md)：V8.4.1 Terra-3 的 CK3/启用 Mod 本地化 Resolver、来源冲突保留与 identity/display 合同。
- [v8.4.1-luna-ui-implementation-report.md](v8.4.1-luna-ui-implementation-report.md)：V8.4.1 Luna-1/2/3 的本地化证据展示、语义化世界概览、长字段和复制入口。
- [v8.4.1-terra-query-freshness-implementation-report.md](v8.4.1-terra-query-freshness-implementation-report.md)：V8.4.1 Terra-4/5 的中文实体分析、Localization 反查、Checkpoint as-of 和 STALE Prompt Gate。
- [v8.4.1-luna-prompt-diagnostics-implementation-report.md](v8.4.1-luna-prompt-diagnostics-implementation-report.md)：V8.4.1 Luna-6 的只读 Prompt / World Recall 诊断、Token 分块、Cache Hit 与裁剪项。
- [v8.4.1-sol-3-prompt-source-boundary-review.md](v8.4.1-sol-3-prompt-source-boundary-review.md)：V8.4.1 Sol-3 的中文 Live 日期兼容、Checkpoint as-of、来源优先级与 fail-closed Prompt Gate。
- [v8.4.1-hotfix-luna-implementation-report.md](v8.4.1-hotfix-luna-implementation-report.md)：V8.4.1 Hotfix Luna-H1/H2 的 Token Breakdown 与 Resolver 诊断 UI 实施边界。
- [v8.4.1-hotfix-terra-implementation-report.md](v8.4.1-hotfix-terra-implementation-report.md)：V8.4.1 Hotfix Terra-H1/H5 的 Localization 回退、Historical Alias Bridge 和真实 Checkpoint 查询结果。
- [v8.4.1-hotfix-sol-final-review.md](v8.4.1-hotfix-sol-final-review.md)：V8.4.1 Hotfix Sol-H1/H4 的真实查询矩阵、身份/来源边界与 Prompt UI 自动化审查。
- [v8.4.2-luna-ui-implementation-report.md](v8.4.2-luna-ui-implementation-report.md)：V8.4.2 Luna 前置 UI 的身份歧义隔离、Definition Binding 语义、年度 Delta 和 Freshness 展示。
- [v8.4.2-terra-p0-implementation-report.md](v8.4.2-terra-p0-implementation-report.md)：V8.4.2 Terra 的身份解析、War parser、Delta provenance 与 CJK Prompt 安全边界。
- [v8.4.2-sol-final-review.md](v8.4.2-sol-final-review.md)：V8.4.2 Sol 的 P0/P1 审计、真实 1156→1157 存档 Historical/War Gate 与实现冻结结论。
- [v8.4.2-run-command-lifecycle-hotfix-implementation-report.md](v8.4.2-run-command-lifecycle-hotfix-implementation-report.md)：V8.4.2 P0 的 Conversation Close 生命周期、Run Command Queue v3、carrier 恢复和确定性回归。
- [v8.5-luna-player-semantic-ui-implementation-report.md](v8.5-luna-player-semantic-ui-implementation-report.md)：V8.5 Luna 玩家语义展示层、默认 UI 内部字段隔离和高级诊断保留。
- [v8.5-terra-retrieval-implementation-report.md](v8.5-terra-retrieval-implementation-report.md)：V8.5 Terra 的确定性 Query Planner、Retriever/Ranker、DTO、缓存 revision 和 token 预算边界。
- [v8.5-sol-internal-review.md](v8.5-sol-internal-review.md)：V8.5 Sol 白屏根因、分页/后台本地化修复、正确性回归和未完成的实机预冻结 Gate。
- [v8.5.1-historical-definition-index-terra-implementation-report.md](v8.5.1-historical-definition-index-terra-implementation-report.md)：V8.5.1 Terra 通用 Historical Definition Index、Worker、绑定安全门禁和 fixture 矩阵。
- [v8.5.2-terra-runtime-identity-implementation-report.md](v8.5.2-terra-runtime-identity-implementation-report.md)：V8.5.2 Terra Runtime-native、Domain DTO、世界线差异、全名来源和历史映射显示边界。
- [v8.5.2-sol-correctness-review.md](v8.5.2-sol-correctness-review.md)：V8.5.2 Sol Stage 3 后端正确性、False Resolution、DTO/IPC 与来源优先级审查。
- [v8.5.2-luna-ui-implementation-report.md](v8.5.2-luna-ui-implementation-report.md)：V8.5.2 Luna Stage 4 玩家语义、Worldline Difference、多实体诊断和 A/B/C 层 UI 边界。
- [v8.5.2-sol-ui-boundary-review.md](v8.5.2-sol-ui-boundary-review.md)：V8.5.2 Sol Stage 5 additive/legacy DTO 一致性、来源优先级、降级安全和 A/B/C 泄漏审查。
- [v8.6-astra-transition-contract.md](v8.6-astra-transition-contract.md)：V8.6 角色知识、字段级事实、共享检索/主观缓存、Secret/Presence 与兼容切换合同。
- [v8.6-sol-stage-1-safety-review.md](v8.6-sol-stage-1-safety-review.md)：V8.6 给名身份 P0、历史来源 variant P1、Character Knowledge 与 Secret 安全合同。
- [v8.6-terra-stage-2-implementation-report.md](v8.6-terra-stage-2-implementation-report.md)：可信完整姓名、Runtime reverse index、Worker 恢复和 Base Game Discovery 2.0。
- [v8.6-terra-stage-3-subjective-world-report.md](v8.6-terra-stage-3-subjective-world-report.md)：共享候选、Scope、定向 Memory、主观 View 与 Prompt Phase A 边界。
- [v8.6-sol-stage-4-safety-review.md](v8.6-sol-stage-4-safety-review.md)：共享/主观缓存隔离、Secret/DTO 脱敏、逐事实 Scope、Prompt 入口审计与 Luna 安全交接合同。
- [v8.6-luna-stage-5-implementation-report.md](v8.6-luna-stage-5-implementation-report.md)：安全 Subjective DTO IPC、回应角色选择、单角色/A-B 诊断 UI、Secret 计数脱敏和 Sol Stage 6 交接边界。
- [v8.6-sol-final-correctness-review.md](v8.6-sol-final-correctness-review.md)：Stage 6 复审、字段公开范围、结构化 Temporal Gate、真实 PromptBuilder 唯一注入及剩余实机 Gate。
- [v8.6-terra-production-subjective-prompt-report.md](v8.6-terra-production-subjective-prompt-report.md)：字段级公开范围、Historical Phase B 与生产 Subjective Prompt 实施及 Sol 复审边界。
- [v8.6.1-sol-stage-1-compatibility-contract.md](v8.6.1-sol-stage-1-compatibility-contract.md)：V8.6.1 Prompt 调序、Global Headroom、Memory 冻结、事实优先级、Secret 与失败隔离合同。
- [v8.6.1-terra-stage-2-3-implementation-report.md](v8.6.1-terra-stage-2-3-implementation-report.md)：V8.6.1 Prompt / Budget、Realm / Observation 与 Scoped Supplemental 实施和边界。
- [v8.6.1-sol-stage-4-safety-review.md](v8.6.1-sol-stage-4-safety-review.md)：V8.6.1 Memory-first Context、Secret/Scoped Supplemental、事实仲裁、确定性与指标独立审查。
- [v8.6.2-sol-implementation-and-final-review.md](v8.6.2-sol-implementation-and-final-review.md)：V8.6.2 Subjective 输出、第三人证据、亲属/死亡/时间事实、发布门禁与人工验收边界。
- [VOTC_v8.1_Campaign_Identity与Worldline_Store_Foundation设计.md](VOTC_v8.1_Campaign_Identity与Worldline_Store_Foundation设计.md)：V8.1 存档身份协议、session 降级、Worldline schema、原子持久化和 Shadow 集成合同。
- [v8.1-campaign-identity-worldline-store-implementation-report.md](v8.1-campaign-identity-worldline-store-implementation-report.md)：V8.0 P0/P1 审计、V8.1 应用与 Workshop 实施、自动化验证和实机边界。
- [v8.3.1-historical-figure-dashboard-implementation-report.md](v8.3.1-historical-figure-dashboard-implementation-report.md)：V8.3.1 实机诊断 Snapshot、Overlay Dashboard、append-only Ground Truth 与冻结边界。
- [v8.3-historical-figure-resolver-implementation-report.md](v8.3-historical-figure-resolver-implementation-report.md)：V8.3 人物匹配数据、Canonical 输入、精确名称门禁、身份评分、Shadow 集成与人工 Gate 边界。
- [v8.3-prerequisite-fixes-implementation-report.md](v8.3-prerequisite-fixes-implementation-report.md)：V8.3 前置 EOL、GameData 状态归属和 Shadow metadata 加固，以及仍需 CK3 实机完成的 Gate。
- [v8.0-historical-baseline-2.0-implementation-report.md](v8.0-historical-baseline-2.0-implementation-report.md)：V8.0 结构化历史基线、兼容适配、shadow Temporal Gate、Prompt/cache 等价和发布验证边界。
- [VOTC_v7.8_main.js第一轮模块化拆分实施记录.md](VOTC_v7.8_main.js第一轮模块化拆分实施记录.md)：Pre-V8 组合根、游戏数据、Prompt、摘要、信件和运行服务拆分边界及验证结果。
- [VOTC_v7.7_main.js架构拆分与迁移清单.md](VOTC_v7.7_main.js架构拆分与迁移清单.md)：V7.7 Provider Service、Provider 与 IPC 分阶段拆分范围、依赖边界和验证清单。
- [README_摘要系统.md](README_摘要系统.md)：Memory Engine 4.0 可见标签、3.0 协议、2.5 数据合同和人物目录视角摘要系统。
- [V7阶段优化记录.md](V7阶段优化记录.md)：V7.0 至当前 V7.x 的功能、修复和验收边界。
- [V6阶段优化记录.md](V6阶段优化记录.md)：V6.2 至 V6.9.1 的动作系统、缓存和架构记录。

### 版本设计与实施报告

- [v8.14.2-third-party-memory-recall-hotfix-report.md](v8.14.2-third-party-memory-recall-hotfix-report.md)：A/B/C 多人对话中 NPC 发言提及 D 的当前轮召回、Memory4 实体合并、Legacy 正文姓名消歧及发布门禁限制。
- [v8.14.2-fix4-implementation-report.md](v8.14.2-fix4-implementation-report.md)：第三人动作型直接引语 speaker provenance 收口、回归证据与待 CK3/Provider/Soak Gate。
- [v8.14.2-entity-naming-disclosure-hotfix-report.md](v8.14.2-entity-naming-disclosure-hotfix-report.md)：已有关系与源文姓名进入 Durable、原话披露事故修复、历史年龄与获知日期及离线/实机边界。
- [v8.14.2-owner-scoped-disclosure-implementation-report.md](v8.14.2-owner-scoped-disclosure-implementation-report.md)：Known Entity Owner-scoped Disclosure、Finalization/Letter 来源门禁、Current Truth、手工覆盖、人物认知 UI 与待验收 Gate。
- [v8.4-gamestate-performance-benchmark.md](v8.4-gamestate-performance-benchmark.md)：指定存档的只读性能勘探基准；不是发布 SLA。
- [v8.4-gamestate-capability-report.md](v8.4-gamestate-capability-report.md)
- [v8.4-ck3-save-container-report.md](v8.4-ck3-save-container-report.md)
- [v8.4-gamestate-schema-notes.md](v8.4-gamestate-schema-notes.md)
- [v8.4-gamestate-adapter-index-proposal.md](v8.4-gamestate-adapter-index-proposal.md)
- [v8.4-live-probe-delta-hook-feasibility.md](v8.4-live-probe-delta-hook-feasibility.md)
- [v8.4-historical-definition-id-report.md](v8.4-historical-definition-id-report.md)
- [v8.4-definition-runtime-mapping-report.md](v8.4-definition-runtime-mapping-report.md)
- [v8.4-modded-historical-character-source-report.md](v8.4-modded-historical-character-source-report.md)
- [v8.4-historical-id-ui-source-report.md](v8.4-historical-id-ui-source-report.md)
- [v8.4-historical-definition-catalog-proposal.md](v8.4-historical-definition-catalog-proposal.md)
- [v8.4-live-date-historyid-validation.md](v8.4-live-date-historyid-validation.md)
- [v8.4-s0-s1-checkpoint-diff-report.md](v8.4-s0-s1-checkpoint-diff-report.md)
- [v8.4-annual-delta-reconciliation-matrix.md](v8.4-annual-delta-reconciliation-matrix.md)
- [v8.4-definition-override-validation.md](v8.4-definition-override-validation.md)
- [v8.4-final-freeze-readiness-review.md](v8.4-final-freeze-readiness-review.md)
- [v8.4-luna-worldline-frontend-implementation-report.md](v8.4-luna-worldline-frontend-implementation-report.md)
- [v8.4-terra-worldline-runtime-implementation-report.md](v8.4-terra-worldline-runtime-implementation-report.md)
- [v8.4-sol-implementation-freeze-review.md](v8.4-sol-implementation-freeze-review.md)
- [v8.4.1-terra-phase-a-implementation-report.md](v8.4.1-terra-phase-a-implementation-report.md)
- [v8.4.1-sol-1-p0-correctness-review.md](v8.4.1-sol-1-p0-correctness-review.md)
- [v8.4.1-terra-localization-implementation-report.md](v8.4.1-terra-localization-implementation-report.md)
- [VOTC_v8.1_Campaign_Identity与Worldline_Store_Foundation设计.md](VOTC_v8.1_Campaign_Identity与Worldline_Store_Foundation设计.md)
- [v8.1-campaign-identity-worldline-store-implementation-report.md](v8.1-campaign-identity-worldline-store-implementation-report.md)
- [v8.3.1-historical-figure-dashboard-implementation-report.md](v8.3.1-historical-figure-dashboard-implementation-report.md)
- [v8.3-historical-figure-resolver-implementation-report.md](v8.3-historical-figure-resolver-implementation-report.md)
- [v8.3-prerequisite-fixes-implementation-report.md](v8.3-prerequisite-fixes-implementation-report.md)
- [v8.7.1-terra-implementation-report.md](v8.7.1-terra-implementation-report.md)：V8.7.1 Terra 分支安全、Current Truth、时间合同、人物/测试 API 与单实例写入保护。
- [v8.7.1-luna-implementation-report.md](v8.7.1-luna-implementation-report.md)：V8.7.1 Luna 玩家优先编辑器、模板、人物选择、召回引导与可读诊断。
- [v8.7.1-sol-final-review.md](v8.7.1-sol-final-review.md)：V8.7.1 Sol 分支、Current Truth、Secret/ACL、Memory/Cache 与 UI/API 最终正确性审查。
- [v8.7.2-terra-implementation-report.md](v8.7.2-terra-implementation-report.md)：V8.7.2 Terra Current Truth 双值合同、CK3 载入边界及 Legacy Supplemental 只读迁移。
- [v8.7.2-luna-implementation-report.md](v8.7.2-luna-implementation-report.md)：V8.7.2 Luna Current Truth 只读预览、Load Boundary 分支选择和 Legacy Supplemental 迁移 UI。
- [v8.7.2-sol-final-review.md](v8.7.2-sol-final-review.md)：V8.7.2 Sol Load Session、Legacy 迁移原子性/ACL、Current Truth 与默认世界线 UI 最终正确性审查。
- [v8.8.3-sol-final-review.md](v8.8.3-sol-final-review.md)：V8.8.3 Sol Action 真实回读合同、参数一致性、Relationship Current Truth 与最终静态门禁。
- [v8.0-historical-baseline-2.0-implementation-report.md](v8.0-historical-baseline-2.0-implementation-report.md)：V8.0 Historical Baseline 2.0 实施、测试与实机 smoke 边界。
- [v7.10-official-action-letter-recovery-implementation-report.md](v7.10-official-action-letter-recovery-implementation-report.md)：V7.10-RC1 至 RC6 Final Rev.3 Candidate 官方 Action 迁移、启动 ACK Reconciliation、崩溃安全 dispatch、BLOCKED/STALLED 恢复、只读 debug.log、路径/Tail 事务、Date Producer Recovery、Canonical Relative Profile、统一 Kinship Resolver、Artifact Diagnostic 3.0 与验证边界。
- [upstream/votc-2.0.3-action-manifest.md](upstream/votc-2.0.3-action-manifest.md)：官方 Action Kernel Blob SHA、适配路径和语义边界。
- [upstream/votc-2.0.3-letter-manifest.md](upstream/votc-2.0.3-letter-manifest.md)：官方 Letter Kernel Blob SHA、Delivery Effect 与可靠性外层边界。
- [Third-Party Notices](../THIRD_PARTY_NOTICES.md)：上游出处、GPL-3.0-only 声明与 VOCT-NEW 适配范围。
- [v7.9.3-action-engine-4.0-implementation-report.md](v7.9.3-action-engine-4.0-implementation-report.md)
- [VOTC_v7.9.3_Action_Engine_4.0正式实施规格书.md](VOTC_v7.9.3_Action_Engine_4.0正式实施规格书.md)
- [VOCT-NEW_v7.9.3_AE4_最终实机前修复清单_含Injury裁定.md](VOCT-NEW_v7.9.3_AE4_最终实机前修复清单_含Injury裁定.md)：Phase 7 前最终裁定与 Hard Gate。
- [VOCT-NEW_V7.9.3_AE4_实机前修复清单.md](VOCT-NEW_V7.9.3_AE4_实机前修复清单.md)：已由最终清单修正 Injury 方向的历史文件。
- [AE4_Spec_Errata-001_Self-Target目标约束冲突修正.md](AE4_Spec_Errata-001_Self-Target目标约束冲突修正.md)
- [v7.9.2-final-stable-implementation-report.md](v7.9.2-final-stable-implementation-report.md)
- [VOTC_v7.9.2_Social_Consequence_Engine_设计规格.md](VOTC_v7.9.2_Social_Consequence_Engine_设计规格.md)
- [VOTC_v7.9.1_生产稳定性修复实施记录.md](VOTC_v7.9.1_生产稳定性修复实施记录.md)
- [VOTC_v7.9_Action_Engine_3.0实施记录.md](VOTC_v7.9_Action_Engine_3.0实施记录.md)
- [VOTC_v7.8.2_V7最终收尾修复实施记录.md](VOTC_v7.8.2_V7最终收尾修复实施记录.md)
- [VOTC_v7.8.3_Memory_Engine_2.5实施记录.md](VOTC_v7.8.3_Memory_Engine_2.5实施记录.md)
- [VOTC_v7.8.1_暂时离场与Prompt修复实施记录.md](VOTC_v7.8.1_暂时离场与Prompt修复实施记录.md)
- [VOTC_v7.8_main.js第一轮模块化拆分实施记录.md](VOTC_v7.8_main.js第一轮模块化拆分实施记录.md)
- [VOTC_v7.7.4_稳定性与基础设施实施记录.md](VOTC_v7.7.4_稳定性与基础设施实施记录.md)
- [VOTC_v7.7.3_Memory_Engine_2.4实施记录.md](VOTC_v7.7.3_Memory_Engine_2.4实施记录.md)
- [VOTC_v7.7.2_候场加入与主动离场实施记录.md](VOTC_v7.7.2_候场加入与主动离场实施记录.md)
- [VOTC_v7.7.1_Memory_Engine_2.3实施记录.md](VOTC_v7.7.1_Memory_Engine_2.3实施记录.md)
- [VOTC_v7.7_main.js架构拆分与迁移清单.md](VOTC_v7.7_main.js架构拆分与迁移清单.md)
- [VOTC_v7.2_人物目录定向召回与P0收口设计方案.md](VOTC_v7.2_人物目录定向召回与P0收口设计方案.md)
- [VOTC_v7.3_动态称谓身份与死亡记忆生命周期.md](VOTC_v7.3_动态称谓身份与死亡记忆生命周期.md)
- [v6.6.1-implementation-report.md](v6.6.1-implementation-report.md)

### 历史更新与 UI 资源

- [v6.1_中文化更新说明.md](v6.1_中文化更新说明.md)：早期中文化更新记录，作为历史资料保留。
- [UI_ASSET_PROMPTS_2.0.3.md](UI_ASSET_PROMPTS_2.0.3.md)：外挂 UI 主题和素材提示词。

## 维护规则

- 新版本先在根目录 [CHANGELOG.md](../CHANGELOG.md) 增加一行入口，再把详细内容写入对应的阶段记录或设计/实施文档。
- 已发布版本的设计文档保留原文；发现实现与方案不一致时，在对应实施报告或阶段记录中追加修订说明，不覆盖历史结论。
- 文档只描述仓库中的真实文件和已验证行为，不为缺失的源码、模板或构建流程创建占位链接。
- 文档文件名使用 `VOTC_vX.Y_主题.md`、`vX.Y-implementation-report.md` 或已有阶段记录名称，避免继续在根目录新增版本散文档。
