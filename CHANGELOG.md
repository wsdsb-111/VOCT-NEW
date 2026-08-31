# VOTC 版本变更入口

这里是版本变更的单一入口。详细设计和测试证据保留在链接目标中，本文件只维护版本顺序、用户可见摘要和文档索引。

| 版本 | 重点 | 详细记录 |
| --- | --- | --- |
| v7.10.0-RC6 Final Rev.2 Candidate | Rev2 以持久化串行 Run Command Queue 统一 Action/Letter/Conversation Close：每条命令带独立 ID，只有 CK3 `VOTC:RUN_ACK` 才推进，正常流程不再全文件 clear。Date Tracker 区分 Tail、Producer、Fresh Marker 与 Progress，旧日志扫描不再假报健康；投递日固定为 Payload `sendDay + delay`。第三方亲属资料合并多来源 gender/birth/relation 证据，统一 Parent/Child 优先、exact birth 优先、冲突中性化的 Kinship Resolver。真实 D0–D5 与关系实机 Gate 通过前不标 Stable | [实施报告](docs/v7.10-official-action-letter-recovery-implementation-report.md) |
| v7.10.0-RC5 Candidate | 在 Official VOTC 2.0.3 Action Core 外新增只读 Critical Action Availability Diagnostics，覆盖受伤、死亡与七类关系动作的可用性、合法目标、来源/目标、选择、校验和 Effect 结果；新增默认关闭的 `state-transition-overlay/v1` 与 DeepSeek Stable Prefix A/B/C，稳定排序只接受 `blockId` 元数据并在异常时保持官方顺序安全回退。RC4 Letter 实现不变；真实 Recall、Wrong Target、Critical FP、缓存与 CK3 Gate 未完成前不标 Stable | [实施报告](docs/v7.10-official-action-letter-recovery-implementation-report.md) |
| v7.10.0-RC4 Candidate | Action 冻结在 RC3 实机通过基线；Letter 新增 `letters.txt`/`votc.txt` Transport A/B 裁定，只在真实 A1 FAIL + A2 PASS 后将正式 Outbound Effect 切换到既有 Action RunFileManager。入口 Numeric Gate 阻止非法 `totalDays`/`delay` 进入状态与持久化，旧异常 Pending 自动隔离；Diagnostic 2.3 严格按 A1/A2/A3/B/C/D 解锁，并新增一键清除待送达队列与阻塞锁。真实 CK3 Gate 未完成前不标 Stable | [实施报告](docs/v7.10-official-action-letter-recovery-implementation-report.md) |
| v7.10.0-RC3 Consolidated | Letter 新增 Pending-only 日期监督、尾部对账、向前补追、手动重同步、结构化 Provider 错误与同 ID 手动重试；Effect Diagnostic 2.2 拆分 WRITE/EXECUTE/VERIFY，并使用已知 Letter ID 和顺序解锁。DeepSeek Action 默认只在本地保留官方 Full Schema，HTTP Prompt 去除重复 Schema；Stable Prefix 仍默认关闭，真实 Action/Token 与 CK3 Gate 未完成前不标 Stable | [实施报告](docs/v7.10-official-action-letter-recovery-implementation-report.md) |
| v7.10.0-RC2 Candidate | DeepSeek Action Provider 固定使用官方 Full Schema，参数继续与 Chat/Summary 隔离；新增 8 段 Action Token 元数据与 Letter A/B/C/D、Payload、Popup/ACK 时序诊断。Sol 对照确认 Desktop 2.0.3 Letter Effect 与 Workshop 2.0.4 命名合同一致，并确认 `LETTER_ACCEPTED` 在事件窗口创建时发出；真实 Action Recall、RC2 Token 与 CK3 Artifact 仍待实机验收，未标 Stable | [实施报告](docs/v7.10-official-action-letter-recovery-implementation-report.md) |
| v7.10.0-RC1 | 官方 VOTC 2.0.3 Action System 全量迁移：退休 AE3/AE4、Action Mode、Pending 与 Social Consequence，以官方 Prompt/Schema/Registry/审批/Effect 和 28 个标准动作为唯一基线；P1 恢复 Action Provider 参数直通与 DeepSeek 局部适配，补齐 Presence-safe 官方离场摘要；Letter 恢复官方 Prompt/Delivery Effect，并加入跨重启、单通道排队、日期推进、日志恢复、投递诊断与 CK3 接受确认清理。当前为实机候选，未宣称 Stable | [实施报告](docs/v7.10-official-action-letter-recovery-implementation-report.md) / [Action 上游清单](docs/upstream/votc-2.0.3-action-manifest.md) / [Letter 上游清单](docs/upstream/votc-2.0.3-letter-manifest.md) |
| v7.9.3 | Action Engine 4.0：共享 Action Contract、Consent Timing、普通 Question/明确 Consent Proposal 分流、当前消息 Pending Evidence、三态 Performance Guard、AE4 参与者不可变、Injury attacker→victim 裁定、Historical Replay 门禁与 172 条多人 Benchmark；Memory Engine 2.5 新增摘要 Presence Boundary 与 Perspective Coverage 门禁 | [实施报告](docs/v7.9.3-action-engine-4.0-implementation-report.md) / [正式规格](docs/VOTC_v7.9.3_Action_Engine_4.0正式实施规格书.md) / [最终实机前修复清单](docs/VOCT-NEW_v7.9.3_AE4_最终实机前修复清单_含Injury裁定.md) / [Errata-001](docs/AE4_Spec_Errata-001_Self-Target目标约束冲突修正.md) |
| v7.9.2 | Social Consequence Engine 与信件链路稳定性收口：本地证据权威、受限关系跃迁、多人见证与语义冷却；信件载荷有界重试、全过程状态和 Memory/Prompt 降级；结构化 Schema 独立诊断 | [V7.9.2 实施报告](docs/v7.9.2-final-stable-implementation-report.md) / [设计规格](docs/VOTC_v7.9.2_Social_Consequence_Engine_设计规格.md) |
| v7.9.1 | Action Engine 3.0 生产稳定性：Precision Gate 后置、多人绑定优先、受限 Judge 输入、社交/亲密事件层、确定性金币转账与统一动作统计；Chat 固定前缀 v4 和 Memory Engine 2.5 动态摘要召回保持不变 | [V7.9.1 实施记录](docs/VOTC_v7.9.1_生产稳定性修复实施记录.md) |
| v7.9 | Action Engine 3.0：平衡、性能、精准三模式，跨轮待定意图、受限语义兜底、两阶段精准判断、模式统计及 Fork 自动更新隔离 | [V7.9 实施记录](docs/VOTC_v7.9_Action_Engine_3.0实施记录.md) |
| v7.8.3 | Memory Engine 2.5：意图门控 Turn Recall、冻结 Session Topic Anchor、动作严格白名单与全部在场人物关系权威层 | [V7.8.3 实施记录](docs/VOTC_v7.8.3_Memory_Engine_2.5实施记录.md) |
| v7.8.2 | V7 最终收尾：修正默认 helper、人物特质、模块依赖和人物摘要落盘，并补齐可跨重启重试的信件延时送达 | [V7.8.2 实施记录](docs/VOTC_v7.8.2_V7最终收尾修复实施记录.md) |
| v7.8.1 | 修复模块拆分后的 Prompt 依赖；新增昏迷、睡着、暂时离开三种可返回暂离模式，并以多段在场窗口隔离缺席期间的回应、动作、召回和摘要 | [V7.8.1 实施记录](docs/VOTC_v7.8.1_暂时离场与Prompt修复实施记录.md) |
| v7.8 | Pre-V8 主进程第一轮模块化：游戏数据、日志解析、Prompt、摘要、信件、设置与运行服务迁出 `main.js`，保持 Memory Engine 2.4 和运行合同不变 | [V7.8 实施记录](docs/VOTC_v7.8_main.js第一轮模块化拆分实施记录.md) |
| v7.7.4 | Memory Engine 2.4 稳定性收口：缓存刷新与指标、CJK Token 估算、来源 ID 严格校验、Git LFS CI 与高风险 IPC 边界 | [V7.7.4 实施记录](docs/VOTC_v7.7.4_稳定性与基础设施实施记录.md) |
| v7.7.3 | Memory Engine 2.4：人物目录读取缓存与写入失效、来源 `messageId` 第四层可信校验、摘要管理按钮合并 | [V7.7.3 实施记录](docs/VOTC_v7.7.3_Memory_Engine_2.4实施记录.md) |
| v7.7.2 | 多人对话候场、请入内与请离场；按人物半开在场窗口限制回应、知情和配对视角摘要 | [V7.7.2 实施记录](docs/VOTC_v7.7.2_候场加入与主动离场实施记录.md) |
| v7.7.1 | Memory Engine 2.3：按 `owner × counterpart` 隔离知情与主题；冻结直接关系与场外人物召回；前缀指纹、结构化摘要重试、死亡墓碑和 DeepSeek 思考摘要 | [V7.7.1 实施记录](docs/VOTC_v7.7.1_Memory_Engine_2.3实施记录.md) |
| v7.7 | `main.js` 分阶段拆分；Provider/IPC 模块化；补齐鱼水之欢、情人和灵魂伴侣的自然完成态触发 | [V7.7 实施与迁移清单](docs/VOTC_v7.7_main.js架构拆分与迁移清单.md) |
| v7.6.1 | 终局摘要全量有向文件核验、人物目录独立编辑与删除、恢复竞争隔离、2–12 人回归 | [V7阶段优化记录.md](docs/V7阶段优化记录.md#第十一阶段v761摘要目录全量落盘核验) |
| v7.6 | 主进程健康化第一阶段、共享脚本沙箱、safeStorage、Memory 数据契约、统一发布门禁 | [V7阶段优化记录.md](docs/V7阶段优化记录.md#第十阶段v76架构健康化安全存储与验证闭环) |
| v7.0–v7.5 | Memory Engine 2.0–2.2、人物目录摘要、动作与记忆收口 | [V7阶段优化记录.md](docs/V7阶段优化记录.md) |
| v6.6.1 | 动作人物方向、参与者绑定和语义合同修复 | [v6.6.1-implementation-report.md](docs/v6.6.1-implementation-report.md) |
| v6.2–v6.9.1 | 动作系统重构、多人摘要、缓存、执行绑定和架构收口 | [V6阶段优化记录.md](docs/V6阶段优化记录.md) |
| v6.1 | 中文化和早期提示词更新 | [v6.1_中文化更新说明.md](docs/v6.1_中文化更新说明.md) |

## 当前维护约定

- 当前应用基线以根目录 [README.md](README.md) 的“版本信息”为准。
- V6 后续记录只追加到 [V6阶段优化记录.md](docs/V6阶段优化记录.md)，V7 后续记录只追加到 [V7阶段优化记录.md](docs/V7阶段优化记录.md)。
- 新增独立设计方案或实施报告时，在本表增加一行，并同步更新 [docs/README.md](docs/README.md) 的分类列表。
