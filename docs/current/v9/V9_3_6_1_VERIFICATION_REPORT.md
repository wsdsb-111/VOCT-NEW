# V9.3.6.1 验证报告

状态：验证进行中。Windows／Node 22.23.3。基线为 6c056c0（其代码候选 5681d10），在 .build 隔离检出执行全套构建和离线门禁。源代码修改前工作区干净。

基线隔离副本完成标准六步，payload 293e3ba59be67dddd58c6d3bebfafd47c288fa04ae4892b1961e85b5676fa917，417／417发布组通过；没有用正在施工的源码冒充基线。日志位于 .build/v9361-baseline-*.log。

当前新增清单：550个test文件，422发布组／127历史项。五个新增专项均通过：intent-boundary 12检查；context-limit 90次断言；pair-retrieval-scale 7检查及独立完整基准；recent-dedup 6对抗组；responder-budget覆盖冻结、真实Prompt、响应者隔离、来源修订和续写守卫。旧路由14项、独立MemoryEngine行为69项、FR baseline20项及budget-edge13项也通过定向验证。完整最终候选及窗口结果待下方收口。

## 修复前反例与独立审查

独立QA使用 git show 6c056c0 的旧routing／player-centered／retrieval模块注入真实Engine夹具：三句“记得把信交给玛蒂尔达”“接下来你准备怎么安排玛蒂尔达”“之后还要不要和玛蒂尔达见面”均错误L1，B→C明确索引调用分别1／2／1次。当前版本对应L0，第三人索引／来源调用为0。混合当前指令C＋独立历史问题D只授权D；完整Owner转述扫描可读取其他Pair索引，但不能注入C-only事项或读取L1全文。

Recent去重对抗测试覆盖同文不同ordinal、错key／revision、同日其他source、半条截断及预算整条省略；旧oracle从includes升级共享parser＋ordinal。独立Context审查又发现坏Custom在读取时会静默采用native1M，已修复并独立复测8类非法配置；native仅4096时使用较小窗口。所有输入／元数据为合成。

## 构建与部署

最终候选在标准事务备份下部署；288项source／artifact／deployed映射已通过初轮一致性校验。最终payload和全新Windows检出六步结果待最后核对，不引用早期中间payload作为最终值。

## 验收范围

全部新增 fixture 为合成数据，真实 APPDATA、CK3 存档和凭据不参与测试。真实 CK3、真实 Provider、20–30 轮游戏联调、80–100 轮 Soak 及远端 CI 均为 NOT_RUN；用户可按施工规格场景后续签署。离线模拟不代表实际服务商窗口、命中率或费用验收。

## 待签署实机场景（本轮 NOT_RUN）

24 轮联调：1–4 轮双人普通对话和提醒／未来安排（第三人 L0 零读取）；5–8 轮加入第三／第四人，检查旧会话仍为 4800、新回应者使用自己的玩家 Pair；9–12 轮关系历史 L1、具体经过 L2 和相邻追问（L1 零全文、L2 含失败最多两次）；13–16 轮同名、引用、否定、当前指令 C 加独立历史问题 D；17–20 轮编辑、删除、Forget 与场景／Campaign 切换，检查发送前撤回；21–24 轮 Auto／Custom、90K／128K／256K／512K／1M 和输出预留切换，触发一次 LENGTH 续写及溢出阻断。

100 轮 Soak：以上 24 轮场景循环四次，再以四轮普通对话收尾；记录每轮候选 Pair 数、逻辑索引读取、来源总尝试、耗时、冻结摘要哈希、格式化记忆及完整请求预算。目标是无权限泄漏、无过期源重发、上限稳定且无持续增长；不为填满窗口发送无意义付费文本。不得用此设计或一次离线测试宣称 Soak 已通过。

混合语句相关性额外红例：在D关系中放入不含当前指令关键词的 D_RELATIONSHIP_ONLY 事项，旧中间候选漏掉该事项（.build/v9361-mixed-query-red.log）。历史分句统一用于人物、时间、Pair query与合法Legacy fallback后同一断言通过（green.log）；独立QA复测12项通过。最终完整门禁须使用此修订后的payload，先前中间候选的422组不充作最终验收。
