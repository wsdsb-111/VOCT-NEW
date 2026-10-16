# V9.3.6.3 验证报告

> 本文件保留此前 TwoP1 阶段的历史证据；2026-10-17 综合修复追加 AGE / RECALL / REGEN / OBS，当前结果见[综合实施报告](V9_3_6_3_INTEGRATED_IMPLEMENTATION_REPORT.md)和[综合验证报告](V9_3_6_3_INTEGRATED_VERIFICATION_REPORT.md)。下文数量与哈希仅属于原批次。


状态：本地候选验证完成并部署，2026-10-16；不代表Full Freeze。

基线440251b5c4b0c710b67bff9ca93c277470c28cd9在全新Windows共享克隆内完成标准六步，Node22.23.3；68个LFS资产逐项校验，427组发布门禁退出0，289项payload与原部署一致。原资源和部署回执另保存在.build/v9363-preserved-v9362-runtime。

## 红绿证据

INT-03基线真实Engine的S01/S02均误判L0；PERF-02基线已知Pair的rawSummary缺失产生UNAVAILABLE全量降级。红例保留于.build/v9.3.6.3-int03/red.log及.build/v9363-perf02-v9362-local-scope-red.log。独立QA的非标准旧JSON同stat身份修改也先复现SOURCE_STALE缺失，再修复Owner内容核对。

新增三个专项登记唯一test-manifest，原V9.3.6.1/V9.3.6.2和独立QA继续执行。具体语义、旧档及性能证据见下列矩阵和报告。

## 未执行的外部验收

| Gate | 状态 |
|---|---|
| 真实CK3长历史存档 | NOT_RUN |
| 真实Provider/API | NOT_RUN |
| 20–30轮真实联调 | NOT_RUN |
| 80–100轮Soak | NOT_RUN |
| 远端CI | NOT_RUN |

所有自动化使用合成Owner/Pair/摘要，不能替代这些验收。本轮不推送远端、不改真实用户数据。Windows/Node版本按本轮证据填写；CK3安装exe的FileVersion/ProductVersion为空，游戏运行版本未读取，NOT_RUN。

## S01–S21 真实Engine语义矩阵

21/21通过。S03/S04/S17先建立同Owner/玩家/会话/场景的相邻唯一目标焦点；S14有有效相邻历史绑定，S15场景变更使绑定失效；S13无可信玩家请求。S05和S20预期固定为L2，未使用L1或L2均可的宽松断言。S21为额外未来依赖反例。

| 编号 | 输入 | 预期/实际 | 授权目标 | 第三人read | 第三人resolve |
|---|---|---|---|---:|---:|
| S01 | 政变之后你和玛蒂尔达发生了什么？ | L2/L2 | 玛蒂尔达 | 6 | 2 |
| S02 | 登基之后你和玛蒂尔达关系如何？ | L1/L1 | 玛蒂尔达 | 2 | 0 |
| S03 | 审判以后你们有没有见过面？ | L1/L1 | 玛蒂尔达 | 2 | 0 |
| S04 | 继承争议结束之后，你们的关系发生过变化吗？ | L1/L1 | 玛蒂尔达 | 2 | 0 |
| S05 | 当年政变之后你是怎么处理玛蒂尔达的？ | L2/L2 | 玛蒂尔达 | 2 | 0 |
| S06 | 等政变结束之后，你准备怎么安排玛蒂尔达？ | L0/L0 | 无 | 0 | 0 |
| S07 | 政变之后要不要通知玛蒂尔达？ | L0/L0 | 无 | 0 | 0 |
| S08 | 记得政变之后把信给玛蒂尔达。 | L0/L0 | 无 | 0 | 0 |
| S09 | 不要回忆政变之后的事。 | L0/L0 | 无 | 0 | 0 |
| S10 | 别说废话。登基之后你和玛蒂尔达关系如何？ | L1/L1 | 玛蒂尔达 | 2 | 0 |
| S11 | 不谈玛蒂尔达。政变之后你与丁大人关系如何？ | L1/L1 | 丁大人 | 1 | 0 |
| S12 | “政变之后你和玛蒂尔达发生了什么？”是什么意思？ | L0/L0 | 无 | 0 | 0 |
| S13 | NPC说“政变之后你们怎样了？” | L0/L0 | 无 | 0 | 0 |
| S14 | 那后来呢？ | L1/L1 | 玛蒂尔达 | 4 | 0 |
| S15 | 那后来呢？ | L0/L0 | 无 | 0 | 0 |
| S16 | 政变之后怎么办？ | L0/L0 | 无 | 0 | 0 |
| S17 | 曾经的政变之后你和她如何相处？ | L1/L1 | 玛蒂尔达 | 2 | 0 |
| S18 | 现在你打算怎么处理与玛蒂尔达的旧事？ | L0/L0 | 无 | 0 | 0 |
| S19 | 记得把信交给玛蒂尔达。你以前和丁大人关系如何？ | L1/L1 | 丁大人 | 2 | 0 |
| S20 | 战争之后你和玛蒂尔达发生了什么？ | L2/L2 | 玛蒂尔达 | 6 | 2 |
| S21 | 等政变结束之后你和玛蒂尔达关系如何？ | L0/L0 | 无 | 0 | 0 |

原始匿名计数见[v9363-intent-evidence.json](v9363-intent-evidence.json)。表内只计第三人路径，整次Engine总来源指标还可能包含玩家固定基线读取（例如S08总指标2但第三人实际resolve0），不能混淆。未命中合法历史词项时允许无注入；路由授权本身不保证存在对应历史事实。旧route schema的绑定、focus与dynamic结果失效另有精确断言。

## 旧摘要独立QA

C01–C18与EXTRA、PERMISSIONS、C19–C21共23/23通过。表中范围是各子场景实际值集合；C13/C19含竞争条件下的SOURCE_STALE拒绝，再恢复快照做A/B。C11别名、C12日期/Campaign/Owner、EXTRA Forget/确认与L2失败限额共同覆盖方案复合安全要求。

| 编号 | 候选Pair（safe） | 不确定Pair | 全量fallback | 状态 | A/B比较 |
|---|---|---|---|---|---|
| C01 | 2 | 0 | 0 | PASS | MATCH |
| C02 | 3 | 1 | 0 | PASS | MATCH |
| C03 | 7 | 5 | 0 | PASS | MATCH |
| C04 | 3 | 1 | 0 | PASS | MATCH |
| C05 | 3 | 1 | 0 | PASS | MATCH |
| C06 | 4 | 1 | 0 | PASS | MATCH |
| C07 | 18 | 0 | 1 | PASS | MATCH |
| C08 | 0 | 0 | 0 | PASS | MATCH |
| C19 | 2/18 | 0 | 0/1 | PASS | MATCH |
| C20 | 计数断言 | — | — | PASS | 专项断言 |
| C21 | 计数断言 | — | — | PASS | 专项断言 |
| C09 | 4 | 0 | 0 | PASS | MATCH |
| C10 | 3 | 1 | 0 | PASS | MATCH |
| C11 | 3 | 0 | 0 | PASS | MATCH |
| C12 | 0/4/5 | 0 | 0 | PASS | MATCH |
| C13 | 21/3 | 0/1 | 1/0 | PASS | MATCH |
| C14 | 2 | 0 | 0 | PASS | MATCH |
| C15 | 3 | 1 | 0 | PASS | MATCH |
| C16 | 24 | 22 | 0 | PASS | MATCH |
| C17 | 2 | 0 | 0 | PASS | MATCH |
| C18 | 4 | 0 | 0 | PASS | MATCH |
| EXTRA | 3/2 | 0 | 0 | PASS | MATCH |
| PERMISSIONS | 计数断言 | — | — | PASS | 专项断言 |

匿名完整观测见[v9363-legacy-qa-evidence.json](v9363-legacy-qa-evidence.json)，包含事项身份/顺序、source key/revision顺序和文本hash。C05缺digest/signature局部3/25但由权威拒绝，A/B均SOURCE_STALE；C07真unknown全18/18，fallback1。C16含22个不确定Pair，连同直接/别名命中共保留24/24；全部Pair不确定另由正式100%旧档矩阵补齐。C17文件symlink创建EPERM，只验证静态lstat/共享assertNoLinks guard；旧专项另有Owner目录junction实测，此处不冒充完成文件链接实测。

## C20/C21发送前反例与恢复

首次revision返回后真实Windows同size/mtime并发改写（ctime改变）曾得到valid=true，见.build/v9363-perf02-c20-postrevision-race-before-fix-RED.log；补丁后SOURCE_REVISION_CHANGED，recoveredSnapshotValid=true。完整stat保持的测试shim（明确模拟ctime不变）也先红，补丁后的内容改写SOURCE_CONTENT_CHANGED；身份/Campaign变更同样被拒。正常未变源valid、新快照恢复valid，C21标准Pair源继续有效拒绝变更；没有通过永远拒绝所有旧摘要实现安全。上述细项见匿名QA JSON的C20/C21 notes。

最初性能轮次已完成6169次且无输出差异时，因这项额外来源审查主动停止；部分数据、原source manifest与日志保留.build/v9363-formal-partial-before-send-*.json，不混入最终完整矩阵，也不是按快慢剔除样本。最终候选在补丁后的代码哈希上重新构建、回归、隔离烟测和正式采样。

## 最终构建与交付

运行代码SHA：`6e06672d5bfd065f70ff9a0d68ace6efaf4f74be`。Node v22.23.3；Windows版本及正式测量源码哈希见[环境证据](v9363-performance-source-evidence.json)。CK3安装exe的FileVersion/ProductVersion为空，未启动读取运行时版本（NOT_RUN）。全新Windows快照 2c1180718c17922eb3b13cf2a3613edf4269ff03、初始无.build、68项LFS逐个验证。

| 标准步骤 | 退出码 | 结果 |
|---|---:|---|
| scripts/runtime-dependencies.js | 0 | PASS |
| scripts/build-runtime.js | 0 | PASS |
| scripts/verify-runtime-build.js | 0 | PASS |
| scripts/deploy-runtime-build.js | 0 | PASS |
| scripts/verify-runtime-build.js --deployed | 0 | PASS |
| scripts/test-release.js | 0 | 430/430组 |

实际289项映射、payload 4a5a54504815a3482450d5e6d53c269c988759fe06619a8dc38bafbccea91673；根运行资源与新克隆构建一致，交付部署哈希通过。清单558个测试文件、430发布组、127历史项。完整日志.build/v9363-candidate-test-release.log，聚合.build/v9363-clean-candidate-report.json。末尾letter/log-reader异常来自预期负面夹具，最终发布PASS和退出0均已核对。原V9.3.6.2的289项资源与回执保留.build/v9363-preserved-v9362-runtime；部署事务沿既有脚本备份，不操作真实APPDATA。

正式9116次A/B、8820个B性能样本全部完成，结果及最坏场景见[性能报告](V9_3_6_3_PAIR_PERFORMANCE_AB.md)。冻结旧版单个有范围的旧源触发300/300候选和600次read已另复现；只作为正确性红例，不混入同版本正式计时。

## 隔离窗口

实际VOTC.exe同一隔离profile两次启动，无重复种入。Main加载所有改动模块的部署SHA并与源一致；GLM设置/IPC和实际历史记忆注入、新“登基之后/政变之后”L1/L2通过。旧摘要事项簿折叠、按真实姓名分组、25/2条、分页、三主题、来源弹窗后端复验、预览确认回填、源文件逐字节不变及重启保留均通过。界面与原始证据在.build，仓库仅保存[匿名计数与哈希](v9363-native-evidence.json)。没有开启CK3/Provider。

L0/L1/L2原文读取数0/0/2、固定文本稳定、1410 Tokens在4800内；退休Memory4/Durable的Renderer表面及IPC仍为空。新GLMCustom90000、已有Auto8192保留、1M Custom、不合法小数不保存、256零输入警告与拒绝发送不回归。零Provider调用、零网络尝试。

最终文档复核：7个交付模块语法通过，821个当前文档本地链接通过，git diff --check通过；本地289项部署哈希再次核验。运行代码SHA见上文，后续报告提交不更改运行payload。

原始性能JSON另以core.autocrlf=true执行checkout-index到全新.build目录，字节SHA与报告一致；精确路径-text规则已实际复验，不影响Runtime映射。
