# V9.2.1 缓存专项候选：实施与验证

日期：2026-10-12。基线 `main / 6026713d88deeafef6cf45e6a07405908c98e030`。本轮按用户 [施工规格](V9_2_1_IMPLEMENTATION_SPEC.md) 开发固定 Durable Policy、当前 V8.13 GLM 出站审计和最小缓存诊断，另修复专项负例实际发现的 Forget 重试泄漏。**缓存效果为 HOLD，未签发阶段完成、正式发布或 Full Freeze。**

## 实际修改

| 权威源码 / 工具 | 改动与边界 |
| --- | --- |
| `src/app/main/memory-system/memory4-coordinator.js` | 仅替换 System 中的一句动态额度规则，把额度放 User 尾部 `limits.maxEntries/maxCommitmentTransitions`；所有其他规则逐字保留。每次分块或二分重试请求前重新读取当前 Forget 并与有效片段取交集，空片段不请求。响应后及提交前的原校验仍保留。 |
| `src/app/main/prompts/prompt-builder.js` | 仅识别新的固定 Durable Policy 为 `summary_stable` 诊断区块；不改变 Chat 排列、Prompt/cache anchor 或既有 Block ID。 |
| `src/app/main/analytics/real-request-diff.js` | 端点明确变化时停止将零缓存分类为同端点大前缀异常；原生 0 和 UNKNOWN 不改值。 |
| `src/app/main/analytics/provider-diagnostics.js` | `getStatus()` additive 返回实际 `layoutId`，防止将 GLM profile 标签误认为实际布局。 |
| `scripts/v9.2.1-cache-report.js` | 只读、显式窗口与 history/experiment 分离的白名单聚合器；只有原生缓存报告进入加权 Token 分母，估算请求仍计入总请求及 UNKNOWN。不同 endpoint/layout/cohort 分开，全样本与预先安排的 warm 样本分开。 |

`clear_thinking` 已在 Zhipu 实际请求的 `thinking` 对象内，原指纹本来就覆盖；初审的遗漏猜测撤回，没有增加冗余字段或更改该设置。Provider、Context、Renderer、Bridge 平台重构均未提前实施。

生成资源对应上述四个源码文件，通过现有构建和 durable deployment receipt 部署。Memory4 Store/Repository、schema、Commitment、解析硬限、ACK、Letter 和用户配置均未修改。

## 红绿复现及规则保留

- D-01 红测：原 System 在 `8/8` 与 `6/3` 额度下 SHA-256 不同；修复后一致，User 额度准确不同。已有 Summary Anchor 原字节不变。
- P0 红测：真实 `forgetSummaryProjection` tombstone 在首次 Provider 等待期间发生，随后截断响应二分重试仍含已忘 A 的 ID 和正文。修复后重试只发 C；后来外层 chunk 被遗忘时也不会发送。只核对最终磁盘内容不足以发现该出站泄漏。
- `scripts/fixtures/v9.2-durable-policy.txt` 保存公开 V9.2 原 Policy；专项逐字断言仅额度句发生变化，不依赖手写条款列表掩盖漏改。

| 原规则类别 | 保留证据 |
| --- | --- |
| JSON shape / 六类 memoryType / 无内容 / transitions-only | 完整 Policy 原字节对照、严格解析与独立 transitions-only fixture |
| 原 Fragment ID、Owner/Campaign、allowedEntityIds、presence 不授权实体 | 原字节对照、来源/未知实体/跨 Scope 专项 |
| Self-only / reported 与 CK3 observation 分离 | 原字节对照和原 Memory4 全量门禁 |
| Legacy sourceAsOf、未知日期、不得把未来事实写为当前事实 | 原字节对照、旧 temporal/derived 门禁 |
| 完整 Commitment quote / evidence / expectedRevision / 每个条件 / superseded | 原字节对照、revision 1→2 与 transitions 额度独立 QA、旧 commitment 负例 |
| Owner 是记忆持有人、可信姓名、关系来源、歧义不猜测 | 附加规则全文原字节保留 |
| 128 fragments / 每 Owner 8 entries / 4096 output / 恢复与提交后复验 | 129→128+1、二分、零额度、晚到 Forget 专项及原发布回归 |

D-01～D-11 由新专项、独立 QA 与既有 Memory4/Commitment/恢复/Forget 组共同覆盖；没有改弱旧断言。D-12 原生收益不满足，按下节 HOLD。

## 原生实验与限制

公开 [A/B 汇总](v9.2.1-cache-ab-evidence.json) 只含匿名 hash、原生用量汇总与时间指标，不含 Prompt、人物身份、密钥、响应正文或私有路径。真实请求只使用合成证据，不读/提交真实游戏对话。按官方价格并加 50% 余量的成本上界约 **0.1626 元**，低于用户授权 10 元；账单费用未独立验证，无自动收费重试。

GLM 使用原端点 / `glm-5.3-flash` / `reasoning_effort=high` / `clear_thinking=true` / streaming / 4096 output。A/B 各覆盖同 NPC 20、三 NPC 交替 18、日期推进 10，共 **96 请求，原生缓存报告覆盖 100%**。A/B Chat 生产布局相同，用等长实验首消息标签分离外部缓存；未改变生产 Anchor。

| Cohort | 每个变体请求 | A 全样本 / warm | B 全样本 / warm | 判定 |
| --- | ---: | --- | --- | --- |
| GLM-A 同 NPC | 20 | 92.22% / 96.07% | 92.22% / 96.07% | 无增益；原 V8.13 已可稳定命中 |
| GLM-B 三 NPC | 18 | 76.25% / 87.48% | 76.25% / 87.48% | 自然切换与共同规则复用，不改隐私边界 |
| GLM-C 日期推进 | 10 | 31.95% / 35.10% | 31.95% / 35.10% | 当前事实变化保留，不将变化冻结来抬高命中 |

warm 指同一 conversation/responder 的后续安排样本，不保证供应商缓存驻留；三 NPC 的首次各一请求均计 cold。此合成输入约 1.6K–2.6K Token，不与历史平均约 23K 的 Chat 混作可比收益。A 然后 B 的顺序、路由/TTL/网络均未随机控制；P95 和 TTFT 是观察值，不能据此宣称速度提高或无性能回归。96 个非空 stop 回复及哨兵检查只是质量冒烟，不是完整 RP/CK3 质量验收。

DeepSeek 旧 V9.2 baseline 探针：2 次原生请求，首次 8 条通过本地解析；第二次 stop 响应未通过原有 `parseResult`，立即停止。未保留原响应及精确拒绝码，不能猜测供应商根因。**候选 Durable 未进行原生调用**，20 对与不变额度控制组未完成，收益 UNKNOWN，G4 为 HOLD。新固定 Policy 的结构正确性不冒充真实命中率提升。

## 本地验证

| 检查 | 状态 |
| --- | --- |
| 原 V9.2 完整基线 | 418/418，exit 0 |
| Durable Policy 专项 | PASS：固定前缀、动态 Scope/额度、原字节规则及严格解析 |
| GLM 当前生产 v813 专项 | 12/12 PASS，真实 Conversation/MemoryEngine/PromptBuilder/Zhipu 出站构造，离线传输 stub |
| 独立安全 QA | 8/8 PASS，晚到 Forget、后续 chunk、129 条、额度、承诺证据/revision、未知实体与 Scope |
| 原生用量 / 只读报告 | PASS：0 / positive / missing，usage-only 尾块、估算覆盖率、隐私白名单、端点与 cohort |
| 最终构建 / deployed parity | 286 文件 PASS，payload SHA-256 `24f1e6a85edf555fc3e9bf2467d367300cdb3c648b14c8006704a58b1abbf66a` |
| 最终完整发布门禁 | **422/422 PASS，exit 0**；491 已分类文件、68 historical |
| 打包窗口 / 用户数据复核 | 隔离 VOTC.exe 诊断 off/on、Presence/Memory IPC、改名目录合并及日期排序 PASS；两张窗口截图复核。真实用户 3,758 files / 626,496,659 bytes，变化 0、新增 0，关闭后清单相同。 |
| 最终 SHA 远端 CI / CK3 / Soak | NOT_RUN；未提交或上传，不能继承 V9.2 CI |

沙箱 EPERM 不作为业务失败或通过证据：真实 Store 的原子 rename 在主机权限下运行全部测试，未修改写入合同。

独立最终只读审查未发现本版安全回归。新 Summary 分类仅提供 Policy label/type，不声称现有诊断具备完整 Durable 出站稳定前缀 frame 或新 cache 系统；相关能力留至 V9.4。既有显式 `DEBUG_VERBOSE_LLM` 正文 console 路径不属于本次新增；本轮变量关闭，公开导出仍通过白名单，不把旧日志权限扩大为隐私修复已完成。

本地 [验证 manifest](v9.2.1-verification-evidence.json) 保存源码/部署/测试/公开文档 hash、Gate、日志摘要 hash 与零变动证明。真实日志和截图保持在忽略或私有目录，不复制真实用户清单。

## 版本及 Gate

G0 基线 PASS；G1 固定 Policy 工程门槛 PASS、D-12 原生效果 HOLD；G2 当前路径/安全/静态审计 PASS，不等同 GLM 缓存问题已解决；G3 指标完整性 PASS；**G4 HOLD；G5 仅本地部分，尚未通过。**

遵循规格 §10.1 / §13“最终发布候选”“G0～G5 全部符合时，才对齐版本并冻结”：当前只部署安全/诊断候选，core 9.2、App 9.2.0、UI V9.2 暂保留，不宣称已发布 V9.2.1。Memory 4.0/3.0/2.5、Workshop 2.0.5、Official Action 2.0.3、Three-Mod 1.0.6 及旧 EXE 壳不改。

HOLD 与进入 V9.3 的决定仍交用户，本轮不自动启动后续阶段。剩余事项及回滚见 [问题台账](V9_2_1_P_ISSUE_LEDGER.md) 与 [移交](V9_2_1_HANDOFF_TO_V9_3.md)。
