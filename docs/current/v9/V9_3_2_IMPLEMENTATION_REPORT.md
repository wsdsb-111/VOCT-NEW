# V9.3.2 Durable 与 Action 修复实施报告

用户在 2026-10-13 明确要求按 [V9.3.1 实机后审查](V9_3_1_RUNTIME_REVIEW_20261013.md) 修复问题并将版本定为 V9.3.2。Core/UI 与 App 同步为 9.3.2，Workshop 2.0.5、Memory Engine 4.0/协议 3.0/摘要 2.5、Official Action 2.0.3 保持。

## Durable 修复

- 固定 Policy 明确版本 v9.3.2，完整列举 memoryType、eventTime.status/precision、日期、来源、授权实体和承诺变更合同。Summary cache anchor 与 block IDs 保留，诊断标签按新 Policy 版本显示。
- Wire DTO 在同 Owner 请求内去重人名/关系目录；每片段只引用经授权目录行。只发送用于生成的信息，完整 evidence/Owner/Campaign/来源验证仍保留在本地。禁止从在场 participantIds 推导授权 entityIds，外 Owner 目录行不进入请求。
- 活动承诺只在其精确绑定核心出现在当前来源时提供；这与既有承诺校验的必要条件相同，不放宽完成、取消、替代或原条件覆盖要求。
- 普通请求按 8192 的保守估算输入硬限分块，其中先预留 1024 给修正反馈，片段数仍最多 128。单个完整大片段可单独使用 16384 硬限；再大的片段在发送前安全拒绝，保留原文，不用截断制造完整记忆。反馈只引用已接受事项的类型和来源，不重复其全文；修正超限时仍保留初次合法候选。每 Owner run 最多 32 次生成，单 chunk 业务校验修正最多一次；真实 transport 仍经过 Facade/发送前来源及预算门禁。
- 请求附加短 fragmentRef，模型可用 f0/f1 等准确引用。仅使用该次已发送列表的映射，在严格来源校验前恢复原始 fragmentId；越界引用拒绝，不把别名写入 checkpoint、正文或索引。原始来源 ID、Summary anchor 和 block IDs 保持。
- 内部抽取路径根据已引用的本地来源保守校正时间元数据：非 witnessed/game_fact 不能提升为 observed，而降为 reported；两端日期都缺失时，合法的精度标签归 unknown。不改变正文、日期、实体或引用；来源、日期范围、未来事实和承诺仍严格校验。记录 localMetadataCorrectionCount，直接 strict parser 继续拒绝未经校正的非法输入。
- 单条坏候选不会丢掉同批合格候选。修正只发送已授权来源、有限验证错误码和已接受事项，不将被拒的模型输出当作新证据；非法实体、日期、来源和承诺变更不会入库。合格部分与剩余拒绝数分别记录，全无效响应不得冒充 NO_DURABLE_CONTENT。
- 历史原生恢复还定位到模型将 conversationDate 用作未注明时间的事件日期。仅在日期验证失败的修正请求中说明会话日期/知悉日期不是事件日期证据；来源不支持精确日期时使用空日期和 unknown 精度。来源支持的日期仍保留，原文、实体、引用、未来意图及承诺条件不变。修正前用例失败，修正后通过，并有独立攻击夹具核验。
- 成功 leaf（包括合法 NO_DURABLE_CONTENT）以现有 Recovery schema 1 的可选 version 1 checkpoint 原子保存；保存 scope、sourceContext、每片段证据摘要及合格结果校验和。重启后再次验证，保留尚未 Forget 的成功进度；截断二分的左支成功也不因右支失败而重发。
- sourceRevision、完整性、活动承诺、projection lineage 改变会使旧结果失效；仅可证明的 Forget 删除允许保留完全未受影响的叶。某叶任何来源被 Forget 时，整叶模型结果作废，剩余来源重新评估；请求未返回时发生 Forget 也丢弃整次响应，最多一次有限刷新。跨 Owner/Campaign、损坏 checkpoint 和未知状态保持 fail-closed，不覆盖坏记录或重放未知效果。
- 同版本、同来源的确定性全无效失败不会每次启动自动重复付费。人工恢复或可验证的来源变化可再次处理；旧未升级 Recovery 可读且保留。已提交记录先以 commit proof 闭合，不重新请求。
- Legacy 重压缩复用同一分块/校验/恢复链。所有 Durable 入口保留最终 Store writer、严格 commit 和已退役 Year/Life typed skip。
- 达到每 Owner 8 条额度时准确记录 CAPPED 和实际 evaluatedFragmentCount。提交证明只接受本版本、正整数已评估数量、完整来源/索引/正文证明及确实达到 8 条的合法 CAPPED；伪造较少条目、负数或未知 Policy 不能闭合 Recovery。Legacy 来源异步改变继续返回 STALE，旧结果不发布。
- 默认启用有界匿名 Durable trace，原生用量和估算分开。诊断保留本地校验错误码，Provider 完成、被拒候选、修正和最终业务提交分开，不记录完整对话或凭据。

涉及源码：memory4-coordinator、memory4-store、PromptBuilder、DurableRequestTrace、main.js；同一构建映射部署到 resources/app/out/main。未增加第二份业务 Store 或修改 IPC/摘要目录。

## Action 与人物记忆边界

零写入命令取消后，以写入历史明确报告 dispatched=false。多 Effect 保存各已接受命令的轻量证据，最后一个取消不能掩盖之前已有写入；通用 ACK 和部分命令完成不升级为整个 Action 的效果确认，未知状态不重放。

中途入场的事项缺段经审查是双人投影范围，不是通用漏生成；保留知情者、对话对象相关性和共同在场门禁。人物认知、直观察见、disclosure、Detail/Legacy 召回保持，Year/Life 自动生成不复活。

## 验证与数据保护

新专项测试登记到 test-manifest：Durable pipeline、独立 QA、Action lifecycle。独立攻击包括合法与非法承诺、全无效重试抑制、输入硬限、跨 Owner checkpoint、截断中断、Forget、手改和已提交恢复。旧测试中仅更新新版本/新分块和显式人工恢复的预期，保留旧 Golden baseline，其余正常 Provider wire 字节仍冻结。

在此前批准、ACL 仅当前用户/SYSTEM/管理员可访问的私有目录保存修复前基线，1986 个文件逐文件 SHA-256 校验。备份、API 配置、用户原文、运行日志和账单台账不进入 Git。

本轮原生验证与已有失败 Durable 修复经用户单独授权，共享 USD 1 硬上限；两条已提交 Narrative 的 PENDING 记录获追加范围授权，额度不增加。价格采用当前官方 Flash 高峰上界，发送前同步持久预留。已知原生 usage 结算后释放未使用预留；未知 usage 保留完整预留。每次发送要求已结算费用上界、未明预留和本次最坏预留之和不超过 USD 1；累计历史预留不等同实际收费。维护用量通过既有 UsageAnalytics writer 按真实请求时间与唯一事件 ID 写入，合成请求排除。真实结果、完整发布门禁及最终部署指纹见 [验证报告](V9_3_2_VERIFICATION_REPORT.md)，未验证项不得写成通过。
