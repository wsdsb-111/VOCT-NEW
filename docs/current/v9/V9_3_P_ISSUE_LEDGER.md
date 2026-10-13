# V9.3 问题与支持台账

| 编号 | 级别／状态 | 证据与处置 |
|---|---|---|
| V93-P0-01 | P0 候选已修复 | 未知／length Action此前能触发模拟Effect；完成门前置，新独立负例零Effect，原Schema/ACK保持。最终Gate单独记录。 |
| V93-P0-02 | P0 候选保持通过 | capabilities等待、退避、每个真实transport前复核来源／Forget；既有竞态、分块与二分专项保留。 |
| V93-P0-03 | P0 退役合同保持 | Year/Life自动生成及后台重建固定SKIPPED，历史合法只读及手改保留；没有新增模型入口。 |
| V93-P1-01 | P1 候选已修复 | 提前return／断流未关闭未记账；managed iterator、reader finally与单次usage终结，含未next和pending next。 |
| V93-P1-02 | P1 候选已修复 | SDK隐藏重试与abort后新attempt；SDK0、显式最多2、可取消退避；网络未知送达与部分流不重发。 |
| V93-P1-03 | P1 候选已修复 | 端点／实例能力串用及等待取消不及时；匿名完整key、固定配置、取消目录及发送前变化拒绝。 |
| V93-P1-04 | P1 候选已修复 | GLM flat0被误当原生reasoning、usage缺失混估算；raw字段与canonical三态，0/UNKNOWN/INCONSISTENT单独表示。 |
| V93-P1-05 | P1 原生复现后已修复 | OpenRouter非流补出的undefined miss被误标INVALID；缺失null/undefined保持UNKNOWN/DERIVED，显式bad/-1保留INVALID且不推导。原9次账本保留，跨7Adapter独立负例及9次仅数字离线回放通过，未追加费用。 |
| V93-HOLD-01 | P1-HOLD | GLM缓存驻留／路由／长局zero未证明应用出站问题，本轮不作收益修复；移交V9.4。 |
| V93-NV-01 | NOT_VERIFIED（用户指定模拟） | Player2、Ollama、Gemini没有API；七Adapter离线合同覆盖，未宣传真实端点验收。 |
| V93-NV-02 | PRICE_UNKNOWN | 国内GLM动态价及自定义兼容路由精确计费未闭合，按预算fail-closed，不付费。 |
| V93-P2-01 | P2 既有／范围外 | e1c3c37已存在：ActionEffectWriter抛错也写FAILED dispatchRecords，runInvocation用其非空推断dispatched=true；仍DISPATCH_FAILED、success=false、无commandId。队列和金币门禁独立证明不写Effect。本轮不更改动作生命周期合同，后续动作专项处理。 |
| V93-GATE-01 | 待本轮人工／最终CI | 新CK3、Soak、最终提交SHA CI分别签署，静态／模拟不替代实机；用户前次选择自行推送，未自动推送。 |

代码与专项通过范围见[实施报告](V9_3_IMPLEMENTATION_REPORT.md)，最终计数和真实API结果见[验证报告](V9_3_VERIFICATION_REPORT.md)。

## V9.3.1 后续修复补记

上表保留V9.3当时范围与证据。其V93-P2-01已在V9.3.1候选定向修复：Action失败记录不再推断已接受，新增attempted／accepted，并保留已有命令的待回执入口，ACK仍不等于效果确认。同轮修复Gemini原生缓存／思考及total多组成分统计、部分usage-only覆盖问题。新候选结果和未完成Gate见[V9.3.1验证](V9_3_1_VERIFICATION_REPORT.md)与[新台账](V9_3_1_P_ISSUE_LEDGER.md)；GLM HOLD、旧SHA CI及原生证据不改写。
