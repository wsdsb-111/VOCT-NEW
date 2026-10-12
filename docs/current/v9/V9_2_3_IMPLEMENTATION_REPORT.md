# V9.2.3 退役与 GLM 诊断实施

本候选关闭 Year/Life 的模型生成，保留 Durable、Detail、Legacy 与可验证的历史 Year/Life。正式版本暂保持 App 9.2.0／UI V9.2；完整冻结仍受人工 Gate 约束。

`memory4-derived.js` 固定退役策略，覆盖 schedule/rebuild、buildYear/buildLife/compress、已排队任务及异步返回的写入检查。结果为 `SKIPPED_DERIVED_POLICY`、`generated:false`、`providerRequests:0`。main 的旧 compression callback 改为抛错哨兵，不能借错误 requestType 发送模型请求。后台策略无法撤回此前已经计费的调用，本轮应用关闭后部署。

`memory4-coordinator.js` 对 Recovery 核验 Campaign×Owner、finalization/sourceRevision、索引与正文 revision/hash、known evidence、Forget、Legacy 来源及提交条目集合。只有证明 Durable 已提交的记录可通过既有 mutation journal 清除派生失败恢复记录；未证明、坏 JSON、未知状态、其他 Campaign 保留，不能只凭旧状态或文件存在判完成。真实未提交 Durable 仍走既有受保护恢复路径。

摘要和信件完成流程接受明确的退役 DTO，不再把无须执行的派生阶段当成失败。信件还持久保存零请求／未生成字段；单独的 skip 状态不能短路完成。Durable 失败仍是失败，重试不得重复已经提交的 Durable 或游戏效果。

Renderer 显示退役说明并禁用旧生成按钮；调用函数在确认及 IPC 前退出。历史查看、手改、来源失效、Forget、Detail/Legacy 召回保留。三主题键 parchment/knight/ink 对应游牧／骑士／水墨。未生成的新年度／人生没有新宏观生平概览；用户方案明确接受这一成本优先取舍。

旧测试的模型生成预期改为退役预期。混合测试保留权限、手改、Forget、来源、Journal、Planner 与 Legacy 校验，使用合法历史 fixture；仅纯生成专项整组归档，混合文件中的已退役用例独立标 ARCHIVED，不能算 PASS。

GLM 三个版本的实际应用出站 body/client 配置对照覆盖 101 场景；均相等。包含本地估算 2K/15K/25K/35K、stream、JSON、reasoning、clear_thinking、追加历史及 scope 变化；这些是离线等价证明，不是供应商真实缓存证明。四种 usage fixture 保留零值、UNKNOWN、推理 token 与 usage-only 尾块。旧源码／部署 CRLF 差异仅用于测试比较归一化，生产 Prompt 字节未改。

当前未证明应用侧 GLM 缺陷，未修改 v813 Prompt、缓存锚点、Provider 参数或 SDK。原生合成128次费用估算上界0.666378元；长输入追加、交错NPC和60秒间隔可命中，完全相同body约18分钟后也出现原生零值。具体驻留／调度原因未知。原生合成与真实窗口分别记录，不能将合成高命中冒充实机长局恢复。详见 [验证](V9_2_3_VERIFICATION_REPORT.md) 与 [台账](V9_2_3_P_ISSUE_LEDGER.md)。

施工没有修改真实用户历史 JSON、设置或 API 配置，没有重放 CK3 Action/Letter。回滚使用私有基线与既有部署回执；不能用旧代码重放未知效果。变更集中于八个 Runtime 源文件及对应生成资源，包含 MemoryTrace 退役枚举兼容；协议 3.0、存储 2.5、Workshop 2.0.5、Three-Mod 1.0.6 保持。
