# V9.3.3 实施报告

实施日期：2026-10-14（Asia/Shanghai）。施工规格见 [V9_3_3_IMPLEMENTATION_SPEC.md](V9_3_3_IMPLEMENTATION_SPEC.md)。基线为 main `d397f102d4222386e7f5424a340ac6a8cd444f25`；本次没有创建分支、worktree 或推送。

当前状态：V9.3.3 本地候选已构建部署；来源规划、只读关联、生产派生服务移除及合成原生验证完成。完整发布门禁 441/441 通过；实际历史文件清理仍待具体范围显式授权。新 CK3、远端 CI 与 Soak 尚未验收。

## Durable 来源规划

`memory4-evidence-planner.js` 在 Owner 投影和 Forget 过滤后对全部授权片段进行本地排序，按最多六个时间区间轮流选择重要候选。每个来源身份和原文均保留；相同文字不合并不同消息、说话人或日期。低优先级寒暄排到后面，未知片段仍是候选。本版不启用硬过滤，不将本地浏览计作模型评估。

`memory4-coordinator.js` 沿用分块、请求局部 fragmentRef、严格事实/时间/承诺验证、截断二分及单次业务修正。每 Owner 每场最多八条、常规输入 8192 / 单片段 16384、每请求 128 片段及每轮 32 次生成上限保留。Durable policy 明确版本为 9.3.3，增加重要经历、转述、条件与否定的正反例；Summary anchor、Block ID 和 GLM v813 不改。

检查点记录规划版本、来源摘要、原始顺序和计划摘要。旧 9.3.2 叶不能冒充新计划已完成；已合法提交的 9.3.2 CAPPED 则继续被提交证明接受，禁止为升级重新提取历史 138 份已提交目标。Forget 影响一个叶内任意来源时，整个叶作废；最终提交前再次核对实际有效评估集合。

Store 继续是唯一权威写入路径。可选 `coverageProof` 绑定 Campaign、Owner、conversation/finalization、sourceRevision、来源与计划摘要，分离授权、本地浏览、计划、模型评估、未评估及提交条数。完整评估、配额早停、部分来源和真实空结果有独立状态；旧记录缺的数字保持 UNKNOWN。

## 只读来源关联

`memory4-coverage.js` 通过 canonical entry/bodyHash、Legacy 独立事实 hash、来源谱系、当前权限、revision 和 Forget 计算关联，不写回原文，不调用模型，不生成第二份持久事实库。精确 Legacy 来源、共享来源、仅同场相关和无法验证分别标识；来源一致不等于语义等价。

`summaries-manager.js` 的 Owner DTO 加入当前页聚合，`memory4:getCoverage` / preload 提供最多 40 条的只读明细。旧 Legacy 重压缩覆盖指标单独保留。导航复用严格 Detail 读取，角色、战役、索引、正文或 Forget 变化后拒绝旧响应。

人物记忆页收敛为人物认知、官方追忆、详细长期记忆、Legacy 对话摘要四个页签；新增 Durable 状态与来源关联，保留分页和三主题样式。没有新增自动付费补提取按钮。

## Year/Life 退役与迁移

通用来源判定从旧 derived 服务抽离为 `memory4-source-validity.js`，冻结原谓词的授权兼容行为。Coordinator 仅保留提取配置端口和 canonical commit proof → verified recovery cleanup；未知、损坏、跨 Campaign 或无提交证明的旧 Recovery 保留。Legacy 真实空结果明确 NO_DURABLE_CONTENT；新提取和既有提交路径均要求恢复闭合。统一摘要恢复入口识别有 canonical 证明的 COMPLETE，拒绝把 RECOVERY_UNVERIFIED 计为成功；故障注入验证清理恢复不再次调用模型。

生产 Year/Life 模块、读取、生成、编辑、Profile 指针和 UI 已按职责解除。旧写操作明确拒绝；旧 year/life SourceRef 无效。YEAR/LIFE 查询意图、Detail 的三个按年索引及即时 `conversation_year` 聚合保留。

`retire-year-life-v933.js` 默认 dry-run。迁移限定受管 Sidecar 的精确文件名，不跟随链接；校验 canonical index、metadata 和 entry 后绑定逐字节清单及保护数据指纹。显式确认计划 hash 后才进入权限受限的现有 version 1 summary mutation journal；独占锁阻止并发和启动恢复竞态。中断可以在提交前回滚；成功提交销毁临时内容副本，仅保留无正文审计。用户其他备份和历史 Git 不属于删除范围。

只读盘点：31 个 Owner / 31 个 Sidecar Campaign，11 个 Owner 含 28 份年度和 11 份人生 JSON；总计 315006 字节，未发现 manual_override；29 份元数据含专属旧字段。此盘点尚不是删除结果，应用关闭后重新核验计划哈希 aff2475235f675aa95fe81868ad346aa28c7e6e8e9ac40b4cbdcfc07e4ddb5bb，范围未漂移；尚未删除。

## 验证与剩余 Gate

实际命令、数量、部署 hash、费用和未完成项分别记录于 [V9_3_3_VERIFICATION_REPORT.md](V9_3_3_VERIFICATION_REPORT.md)。应用关闭后已部署，296 项 source/artifact/deployed 哈希一致；现存 2989 个受保护用户文件逐字节不变。新版本 CK3 中长对话、晚段事件、晚入场、跨会话召回、手改/Forget、旧存档升级以及 Soak 尚无真实验收。

引用清债明细见 [V9_3_3_RETIREMENT_REFERENCE_AUDIT.md](V9_3_3_RETIREMENT_REFERENCE_AUDIT.md)。构建和 Git 存储对生成资源显式使用 Windows CRLF/文本规范，使大 bundle 只保留实际内容差异；源码 Prompt 字节保持。

完整修改路径见 [V9_3_3_CHANGED_FILES.md](V9_3_3_CHANGED_FILES.md)。App/Core/UI 均为 9.3.3；Workshop、Memory 协议/存储及 Official Action 版本未升级。
