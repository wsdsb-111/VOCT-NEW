# V9.3.9 实施与代码交付报告

日期：2026-10-18。范围：合并 V9.3.8.1 记忆方案与 V9.3.7.1 修复方案，统一 Core／App／UI 为 9.3.9。起点为 main 的 37df16e5763d4764c451268ad96356fa9bfda848 和此前未提交的 V9.3.8 工作树；没有重置既有工作。

用户最终要求是“只需要完成代码编写就行上传到 github 交给我”。代码与本地自动化已完成，本报告不代表实机验收完成或正式 GitHub Release 声明。[合并计划](V9_3_9_IMPLEMENTATION_PLAN.md)、[记忆方案](V9_3_8_1_DEVELOPMENT_SPEC.md)、[导入原修复方案](V9_3_7_1_FIX_SPEC_IMPORTED.md)保留需求来源。

## 记忆与上下文

- 固定部分为完整 Recent2、合法官方追忆和当前玩家—回应 NPC Pair 的完整合法事项簿。不会把玩家与所有 NPC 的事项簿累加进单个请求。
- 双人／三人时间摘要累计最多 5 篇，第三人摘要全场累计最多 3 篇；4+ 人保持 3+3。比例为配置窗口的 65%／70%／75%，记忆硬上限为 80,000／84,000／96,000 Token，最终仍受完整请求、输出预留及 Provider 安全余量限制。
- 人数分档按玩家和本场已选 NPC（含候场者）首次冻结。候场者加入不驱逐已成功注入的摘要；新场次重新计算。
- 动态来源先作为候选预留全场额度；仅在来源全文实际进入请求、Provider 成功结束且通过现有注入证据门禁后，提交为当前回应者的冻结正文。失败不消耗永久槽位。已提交来源保留全文，不按后续问题重新排序或替换。
- 同一成功问题再次使用冻结正文，不重新检索；后续问题仍带上已冻结摘要。新问题可以在剩余额度中追加合法来源。多回应者共享数量上限，正文与权限仍按回应者隔离。
- 新稳定块 memory-dynamic-frozen 位于可变对话历史前。standard、GLM 和 V813 路径均消费同一冻结正文，来源和人物认知签名进入前缀缓存身份。稳定块身份由 V9.3.9 明确版本化。
- 每次请求继续复核来源键、修订号、内容和 Forget。追加无关摘要不清空仍合法的旧快照；相关来源变化、遗忘、Campaign／玩家／场次变化使对应快照失效。冻结不能扩大来源权限。
- 全文不足时先使用已有较旧对话压缩流程；完整合法来源仍无法装入则在 transport 前暂停，展示所需、可用和组件预算，禁止静默裁剪。
- 继承本轮 V9.3.8 玩家上下文提示：仅一行玩家可见状态，逐场次隔离、逐轮更新，区分估算与最近请求的实际用量。容量读取当前配置，没有替用户将 128,000 改为 192,000。

冻结摘要每次发送仍占输入 Token；稳定文本只提供缓存复用条件，不保证 Provider 原生命中。缓存效果须由真实 Provider cached-token 用量确认。

主要代码：src/app/main/memory-system/{dynamic-summary-freeze,player-centered-memory,memory-engine,memory-budget-policy,summary-date-index,player-memory-diagnostics}.js、conversation/conversation.js、prompts/prompt-builder.js，以及既有 Renderer 上下文提示与 IPC。

## 亲属、导出与年龄

| 原任务 | 本轮代码结果 | 证据边界 |
| --- | --- | --- |
| P1-01／02 | 默认当前关系图严格验证 parents、children、两个方向的 canonical relations；未知来源、错误方向／Owner／Child、过期快照、UNKNOWN 公开性与冲突拒绝 | 新四入口正反例与冲突测试 |
| P1-03 | otherParent 各入口要求同一当前公开来源合同；仅附带字段不授予历史 Memory 权限 | Parser／图／家庭事实／Prompt 反例 |
| P1-04／P2-01 | 新 kids 公开亲子证据尾列由生产 Parser 与 canonical resolver 消费；旧行不升级 | 新旧日志生产 createLogParser 路径、补丁静态适配检查 |
| P1-05 | 继父母与继子女标签有方向；继子女依赖完整公开双亲及当前婚姻，不能推出庶出身份；半亲不误作继亲 | 正反向标签、家庭块、自定义模板过滤 |
| P1-06 | 保留唯一年龄解析路径，提供八层同快照首次偏差诊断及只读脱敏 CLI；不做统一减一 | 静态夹具通过；真实 +1 根因尚未证实 |
| P2-02 | 公共亲子证据、婚姻变动、日期／天数、Campaign 和显式内容修订均参与缓存失效 | 当前固定 contentFingerprint 但快照变化的反例 |

当前图默认 buildKinshipGraph 不接受没有当前来源校验器的亲子记录。V8 纯结构历史回归显式使用 buildLegacyStructuralKinshipGraph，保留原结构断言；此入口不用于当前事实或 Memory 权限。历史 STEP 只接受 LEGACY_TYPED_STEP_RELATION，不能凭任意非空 source 升级。自定义模板的 parents 不含历史 STEP；合法历史继亲单独放在 historicalStepRelations 并标记 STEP_PARENT／HISTORICAL，标准 Prompt 仅按历史措辞消费。

存档生产解析器另为 family_data.father／mother 生成 CK3_SAVE_LEGAL_PARENT 证据，保留 parents 字符串结构兼容性。证据必须同时匹配 schema、playthroughId、gameDate、完整内容 SHA-256、Child／Parent 及当前合法父母指针；real_father／real_mother 不进入公开关系图。该适配避免严格日志门禁同时误拒绝全部合法存档家庭事实。生产 parseGameState → 缓存图／定向图有独立正反例，亲属关系仍不授予秘密或历史 Memory 权限。

[新导出补丁](patches/V9_3_9_KIDS_DIRECT_PARENT_EVIDENCE.patch)对应 Workshop 的 common/scripted_effects/log_character_v2_effect.txt。本轮只在仓库交付补丁，没有改活动 Workshop 安装。对本机 3346777360 的 V9.3.7 补丁 reverse-check 和新补丁 apply-check 通过，只能证明文件适配，不能证明活动 playset 或游戏已加载。

年龄工具：scripts/diagnose-v9.3.9-age.js。输入必须包含同一快照的 CK3 面板、原始导出、Parser、canonical、resolveCharacterAge、家庭块、Prompt 和模型回答；缺少层级或快照不一致输出 INCOMPLETE。只输出脱敏年龄与诊断代码，不回写游戏或年龄。

## 独立人物认知

恢复“摘要 → 个人摘要 → 人物认知”，由独立 CharacterKnowledgeService、IPC 和 Renderer 面板实现。数据使用 VOTC_DATA_DIR/character-knowledge/records-v1.json，按 Campaign／Owner／Target／fact／来源隔离，原子写入并校验人工修订号。

当前来源必须是 ACTIVE 且有效、路径匹配的 autosave Worldline checkpoint，磁盘 size／mtime 仍匹配且 freshness 为 FRESH／AGING。来源过期时读取、写入和 Prompt 桥接均阻断。手动操作令牌额外绑定当前候选事实，旧页面不能覆盖已变更来源。

同领地公开头衔、明确披露给当前 Owner 的已映射运行日志秘密，可形成合法认知；可见外貌特质可按 Owner 手动确认。未知列表只列安全可管理候选，未授权秘密及未分类特质不显示名称或值。支持已知／未知／手动已知／手动隐藏；来源变化后旧人工状态需要重新确认。自身资料保留，其他角色特质和头衔必须经过当前认知过滤。已删除旧 raw knownSecrets 直接旁路，发送前重新核对认知签名。

不读取旧 Sidecar、Memory4 或 Durable，不调用模型提取，不恢复 Year／Life 或后台重建。没有迁移旧人物认知数据。

## 自动化验证

Node：22.23.3。完整发布门禁使用与 GitHub Actions 一致的 Node 22，不把其他 Node 版本下的结果混作发布证据。

- 锁定 Runtime 依赖验证：PASS，5,981 文件／264 包。
- 新增 6 个发布专项：动态冻结、认知 Prompt、亲属来源、年龄 Parser、人物认知服务与独立 QA；全部登记 scripts/test-manifest.js。
- C17 删除越界局部变量引用，保留符号链接／静态安全门禁；整文件 23／23 通过。本机 symlink 创建仍报 EPERM，实际执行的是测试内既有静态 lstat／link guards 分支，不能称为真实符号链接创建验收。
- 源码构建：PASS，296 项映射，App 9.3.9；payload SHA-256：e2e0f2732f41808d87710447bc26f6f6318e26466a4f547fb28f85c6425ae9a5。
- 源码／暂存构建校验和 resources/app 已部署哈希 parity：PASS；指定主进程、Provider、IPC、Worldline、Renderer 语法检查：PASS。
- 完整 Release Regression：PASS，452 groups；进程正常执行至最终汇总行，退出码 0。git diff --check：PASS。

测试仅使用隔离夹具。Windows 文件事务专项在默认沙箱中遇到 EPERM 后，以同一代码在允许原子重命名的执行环境重跑；没有为通过测试削弱持久化事务。

本轮回归发现并修正：来源目录修订变化误清空合法冻结摘要；kids 公开证明在 canonical child relation 中丢失；旧 raw-secret Prompt 旁路；旧正向亲属夹具缺失当前公开证明。历史结构测试更名入口，当前安全反例保持。

执行命令使用 .build/v9331-node22/node.exe：runtime-dependencies.js、build-runtime.js、verify-runtime-build.js、deploy-runtime-build.js、verify-runtime-build.js --deployed、test-release.js，均位于 scripts/；另按根 AGENTS 对主进程／Provider／IPC／Worldline／Renderer 执行 node --check，并执行 git diff --check。隔离日志保存在忽略的 .build/v939-release-final-2.log，不提交运行日志、真实存档或任何用户数据。

## 交接状态

| Gate | 状态 |
| --- | --- |
| 源码与自动化、生成资源 | PASS：452 组完整门禁、296 项生成资源 parity |
| GitHub main 代码上传 | 本报告与源码同一 main 提交；精确 SHA 和上传结果以 Git 远端 ref 核对及交付回复为准 |
| 真实 CK3／导出补丁加载 | NOT_RUN，由用户接手 |
| 真实年龄 +1 首次偏差与修复验收 | NOT_RUN，缺同日期实机八层证据 |
| 实际 Electron UI 冒烟 | NOT_RUN，本轮用户限定代码交付 |
| 游戏内 Provider／缓存命中／Soak | NOT_RUN |
| 当前 SHA 的远端 CI | 上传后单独按 run 状态记录 |
| GitHub Release／签署 Full Freeze | NOT_RUN |

V9.3.7 的 9caffe6 远端 Release Regression 失败属于原 SHA 的历史结果，未被本轮本地测试覆盖或改写。旧 V9.3.8 截图和实机记录也不作为 V9.3.9 验收证据。
