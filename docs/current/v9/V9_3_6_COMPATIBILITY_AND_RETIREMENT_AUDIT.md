# V9.3.6 兼容与退役审计

状态：本地候选审计通过，417 组回归及合成备份／回滚演练通过；真实 CK3、Provider、Soak、最终 SHA 远端 CI 分别验收，不宣称 Full Freeze。

## 数据与读取合同

仅改变读取路由、Prompt 冻结和预算。Legacy 原摘要继续为权威叙事文本；Pair Index 沿用 Campaign＋Owner＋Counterpart、Source Key／Revision、确认状态和来源复验，不做全量迁移。NPC→NPC 合法定向摘要继续保存，晚加入、早离场、耳语、私密知情及 knownBy 不改变。Offline 单 Pair／Owner 预览确认、取消、分页、搜索、日期、来源详情及真实姓名标签保持原 UI 与 IPC。

固定基线为 NPC→玩家 Recent1＋合法 Official＋玩家事项簿。第三人读取仅在可信玩家当前轮次授权后启用；L0 不能经 Mentioned、EntityTarget、Temporal、TopicPatch、历史注释或旧 `past_summaries` 旁路回流。合并的同正文多人投影也必须按获准的关系选来源；L0 玩家往事查询不得借合并投影读取 B→C。

## 来源失效

Source Key／Revision、当前日期、Campaign、玩家和 Owner、会话、真实 Forget ledger、Official 来源指纹共同约束快照。既有同 stat 等长改写内容检测保留。撤销同步影响 Engine 与 Prompt prefix；实际发送、Provider 重试与截断续写必须重新复核来源，不重放已经失效的历史。

## 保持的功能与退役边界

- Legacy 保存／编辑／删除／Forget 与来源事务；索引惰性刷新和历史离线回填。
- Official Recollection 原生合法来源、Owner／会话隔离，不新增替代追忆生成。
- Official Action 2.0.3、RunFile 去重、未知效果不重放、ACK 与 CK3 效果确认区分。
- 信件双向摘要及已有 Narrative 恢复、Worldline 当前事实只读和一对一身份绑定。
- Durable／Memory4 不恢复生产提取、读取、恢复或写入；Year／Life 不恢复生成或后台重建；旧 archive Sidecar 不扫描、不读写、不迁移。
- 既有 V9.3.4 以前 Memory4 Recovery 信件队列未自动迁移；模拟信件通过不代表真实 CK3 投递验收。

协议 3.0、存储 2.5／schema 2、Workshop 2.0.5、Official Action 2.0.3 与 Three-Mod 1.0.6 保持。Core／App／UI 为 9.3.6；复用壳 EXE 文件属性不改写。

## 回滚

`memory-budget-policy.js` 的单一 `PLAYER_CENTERED_RECALL_ENABLED` 配置选择读取与预算政策。关闭后使用旧适配读路径与旧预算表，不能恢复 Durable；已有合法 Legacy 和 Pair 索引不会撤销。回滚需要正常构建、应用退出、部署及一致性校验，不能只手改 out 文件。发布备份／回滚合成演练和最终结果记录于[验证报告](V9_3_6_VERIFICATION_REPORT.md)。本轮不导出或改写真实 APPDATA、摘要、凭据、存档或日志。

演练已完成：隔离候选 288 项代码备份逐项验证，旧读配置构建部署后确认 8K／2人旧额度 819，恢复新配置后的 payload 与最终候选完全相同；合成 Legacy、Forget 与 Sidecar 哈希不变。Legacy／Pair UI、离线确认、来源打开、信件、Official Action、世界线和退役保护均包含在最终 417 组完整回归中；真实 CK3 投递与效果仍不以模拟通过代替。
