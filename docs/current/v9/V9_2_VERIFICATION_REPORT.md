# V9.2 实施与验证报告

日期：2026-10-11。按旧总路线 §7.3 完成应用服务边界、Scoped JSON Repository 及用户追加的同 ID 改名目录合并。本地源码／部署校验、418 组发布门禁、21 项独立 QA 和隔离 VOTC.exe 窗口冒烟已通过；远端最终 SHA 的 CI、真实 CK3／Provider／Soak 仍待验收，未签发 Full Freeze 或正式阶段 COMPLETE。

## 基线与数据保全

在 `main` 工作区开发，HEAD 保持 `f9c088ff384597fa9e07db248a6cc8c6be68113e`，未创建分支／worktree，未提交或上传。开工基线为 413 个发布组通过；追加目录合并前的 285 映射／417 组通过只作为历史快照，本报告最终证据以 286 映射／418 组为准。

V9.1 Release Regression run `38117263132` 已核验对应 `f9c088f` 为 Success；用户在 2026-10-11 确认此前功能正常，标为未量化 `USER_CONFIRMED`，不等同于本轮 CK3 或 Provider 验收。

私有备份逐字节验证通过。userdata 共 3,549 个文件、606,044,541 bytes；代码另备份 572 个文件、Bridge 另备份 8 个文件，不能将后两项计入 userdata。最终隔离窗口冒烟后复核全部 userdata 清单与 SHA-256，变化文件为 0、清单不变。私有路径、文件名、正文和逐文件 hash 清单未复制进仓库。

## 实现及职责

| 范围 | 已实现行为 |
| --- | --- |
| 七域服务端口 | Main 注入 Conversation、Presence、Memory、Worldline、Action、Letter、Persistence 的薄方法边界，绑定原 owner 的 `this` 与错误。ConversationManager 同时提供 conversation／presence；真实会话、消息、Presence、Action、Letter、Worldline 与 audit 入口已接线。 |
| Scoped JSON Repository | 同一 Memory4Coordinator 持有同一 Store 与 Repository。候选 frame 绑定 Campaign×Owner、index revision／hash 和 ID 集合；授权正文读取重新核验来源、knownBy、visibility、修订与实时 Forget。所有索引轴、范围与旧合法结果顺序保留。 |
| 写入与恢复 | MemoryStore／Memory4Store 仍是唯一 writer，Finalization／Forget／恢复仍属于原 Memory Engine／Coordinator。journal 保持 version 1，旧 `files` 合同兼容；新增可选目录记录支持改名迁移回滚。路径／链接／base64 与目录类型均在恢复写入前校验。 |
| 审计 | 显式 `memory4:integrityAudit` 经原上下文授权，返回匿名、只读、有界结果，最多 1,000 条。Legacy OrphanAudit 与原用户确认 Forget 链保持，启动时不自动删除或推断来源。 |
| 构建部署 | 固定正式输出、保护源码／文档／用户目录和链接别名；部署使用 hash 校验的备份与 durable receipt。中断恢复只接受已知前／后版本，恢复前及使用前均核验未知目标变动，拒绝覆盖。 |
| 版本 | 项目／UI V9.2、core 9.2、App 9.2.0。Workshop 2.0.5、Memory 显示 4.0／协议 3.0／存储 2.5、Official Action 2.0.3、独立 Three-Mod 1.0.6 保持。复用的 VOTC.exe 壳文件属性未改写。 |

接口与数据权威见 [服务端口](V9_2_SERVICE_PORTS.md)、[JSON 权威与恢复](V9_2_JSON_AUTHORITY_AND_RECOVERY.md)。[施工规格副本](V9_2_IMPLEMENTATION_SPEC.md) 保留用户原文，设计状态不冒充实现证据。

## 改名目录自动合并

摘要列表及 GameData 对话读写自动按数字 Owner ID 检测重复目录。唯一目录继续复用，不因名字改变另建目录；多个同 ID 目录归并后采用可靠当前姓名，没有当前姓名时参考最近有效摘要中的姓名。对话文件按 counterpart ID 定位，改名不会另起文件，同名不同 ID 也不会混入同一文件。

摘要按有效游戏日期从新到旧排列，日期未知才参考 totalDays；年度条目和人生阶段按时间先后排列。不同 Campaign 保持独立，未绑定 Legacy 保留移动前的 binding ID。只有同 Campaign、完整语义一致且仅姓名／路径元数据不同的镜像去重；不同正文与来源都保留。长期正文、年度／人生视图、官方追忆、手动披露、Forget 与 tombstone 均保留。

原目录及 canonical sidecar 先在 Store `baseDir/renamed-summary-folders` 中备份并逐字节核对，该目录不参与召回。计划至备份期间源内容改变会拒绝迁移。共享 Memory4 sidecar 校验后才合并；同 entry／finalization／source revision／手动内容冲突会停止合并，保留源数据，不选择一份覆盖另一份。合并的派生视图标为 dirty，经过原来源校验／重建才能继续召回。

目录及文件变更沿用原 mutation journal，真实子进程在 canonical sidecar 写入后终止，重启恢复原文件字节、路径及可召回状态，并清除新建空目录。正常唯一目录不扫描全部正文；对话文件定位缓存以文件和目录状态失效。

只读检查当前真实用户数据发现 22 个 owner 目录、0 个重复 Owner ID 组，因此本轮未迁移真实记录。功能验证采用真实 Store／Coordinator 构造的隔离数据及实际 VOTC.exe 的 Renderer／Preload／IPC。

## 验证结果

| 检查 | 最终结果 |
| --- | --- |
| build／deploy／deployed parity | PASS，286 映射；App 9.2.0。payload SHA-256：`4c192c9f2f421f3589858a296cecffb0e08eaff8329be57fd8b50506b7642f04`。 |
| runtime dependencies | PASS，5,981 files／264 packages。 |
| 发布门禁 | `node scripts/test-release.js` exit 0，418 groups；487 个已分类测试文件、68 个历史归档。 |
| Scoped JSON | 33 个 query axis／oracle 用例通过；候选集合、顺序、授权与实时撤销验证通过。 |
| 独立恢复／边界 QA | 21 PASS／0 FAIL；五个 journal／body／known／metadata／index crash checkpoints 真实退出，旧树逐字节恢复，第二次启动幂等。 |
| 原生链接限制 | root／journal junction 实际通过；4 个文件 symlink 的创建被主机权限拒绝，保持 NATIVE_UNVERIFIED；4／4 对应 lstat 注入反例通过生产 validator，不能冒充原生文件链接验收。 |
| 改名合并专项 | 12 个场景通过：同 ID／跨 Campaign／同名不同 ID／Legacy binding／全部记忆保留／派生排序／手改冲突／损坏拒绝／缺失姓名／源内容竞争／junction／中断回滚。 |
| 实际 VOTC.exe 冒烟 | 两个隔离配置诊断 off／on；Presence IPC、unknown audit scope 拒绝、V9.2 标题／footer／App tooltip、真实摘要列表 IPC 合并及日期排序通过。无真实 CK3 或 Provider 请求。 |
| 真实 userdata 复核 | 3,549 files／606,044,541 bytes，变化 0，inventory 相同。 |
| 语法及差异 | 受影响 JavaScript `node --check`、`git diff --check` 通过。 |

公开 [验证 manifest](v9.2-verification-evidence.json) 记录 payload／manifest／测试源／日志 SHA、每个施工 T-ID 的文件／夹具／正负例／结果和 Gate 状态；日志、截图及逐文件 userdata 清单仍在私有或忽略目录。

收尾回归发现并修正了：旧摘要管理器注入对象没有新增姓名方法、无姓名快照错误改名为 unknown、主动迁移唯一目录破坏旧 Official 路径，以及目录事务校验误拦单独配置的恢复目录。最终行为复用原姓名解析器、保留已知唯一目录，并只在同 ID 多目录时合并；普通恢复快照写入保持原配置路径，事务中的目录操作仍严格限定合法 root。已重跑最终全量门禁，没有通过改弱 Official／Forget／Scope 校验消除失败。

## 性能测量及限制

同版本完整 query 与按需读取子集使用 48-entry／30-sample 合成夹具，合法输出 hash 等价；正文读取由 360 次／708,660 bytes 变为 60 次／118,080 bytes。此对照只证明正文 I/O 减少，不是冻结 V9.1 的性能对照。

另从已验证的 V9.1 私有源码备份加载原 Memory4Store，在同机相同合成数据／过滤器上各取 30 样本，并逐次深比较前两个合法正文。基线 commit `f9c088f`；原 Store SHA-256 `1e58bdf5424134bcd8821900cbb2fe038e2b41dae9c5421682c775d7eb24b9ed`。

| 指标 | 冻结 V9.1 完整 query | V9.2 候选＋两个授权正文 |
| --- | --- | --- |
| 正文打开数 | 360 | 60 |
| 读取字节 | 708,660 | 118,080 |
| Node P50 | 8.069 ms | 32.995 ms |
| Node P95 | 11.148 ms | 41.050 ms |

这是同进程预热测量，OS 缓存未受控制，未测冷盘或 CK3 帧时间。新路径减少正文读取，但增加的 Scope／来源／路径／实时撤销检查使此小夹具的耗时上升，不能宣称整机性能改善。完整门禁中的 1,000 条记忆压力测试只证明正文读取有界，不代表可交互延迟已验收。后续优化必须保持所有授权负例，不能以减少校验换速度。

## Gate 与移交

WP-00 基线／备份、WP-01 旧 Review 收口、WP-02 七域端口、WP-03 Scoped JSON、WP-04 候选与权限、WP-05 journal 恢复、WP-06 Legacy／Official、WP-07 构建／回归／文档均完成本地实施及上述验证。WP-04 冷盘、真实启动／帧时间与 Provider 时间测量仍未提供。

G0–G6 本地通过。G7 的隔离打包部分通过，最终提交 SHA 的远端 CI 等用户上传后核验；旧 V9.1 CI 不继承为 V9.2 通过。G8 的真实 CK3 旧档／新档、多人、记忆／遗忘、Action、Letter、Provider 与 Soak 待本轮记录；此前用户已验收的历史功能不降级。六个 Review 问题的本地关闭证据见 [P 台账](V9_2_P_ISSUE_LEDGER.md)。

未签发 V9.2 formal complete 或 Full Freeze。下一功能阶段仅为 [V9.3 Provider Platform](V9_2_HANDOFF_TO_V9_3.md)，不提前进行 Context／Renderer／Bridge 的后续重构。
