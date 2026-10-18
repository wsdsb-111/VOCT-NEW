<<<<<<< Updated upstream
> 当前候选为 V9.3.7，沿用 V9.3.6 玩家中心记忆合同。当前版本及后续收口报告由根 README.md 和 docs/README.md 索引；V9.3.6.3 旧档兼容合同继续有效。otherParent 不扩大 Memory 权限，未验证的日历年龄仅作诊断。CK3／Provider／Soak／远端 CI 分开签署，远端失败不得写成未执行或 PASS。
=======
V9.3.9.1 当前修复补充（优先于下方 V9.3.9 历史状态）：只管理当前对话的定向人物披露；公开发言逐一记录给实际在场听众，私语仅指定人物，候场／缺席不继承。外貌身体沿现有白名单，称号公开；当前可靠公开父母子女及亲兄弟姐妹（含公开半亲）可免披露互知特质，未暴露私生亲属关系不适用。撤下 Worldline 认知服务生产接线，不扫描全体人物；保留原生定向 knownSecrets、手动状态与发送前复核，不恢复 Memory4。V9.3.9 摘要召回／冻结／预算及关系来源实现保持。年龄只移除稳定资料中过期年龄，原实机 +1 缺证据仍 NOT_CONFIRMED。当前报告为 docs/current/v9/V9_3_9_1_IMPLEMENTATION_REPORT.md。本轮按用户要求不连接 GitHub／远端 CI，不执行真实 CK3／付费 Provider／Soak／Release；下方 GitHub 上传说明只属于历史批次。

V9.3.9 补充合同：2／3 人时间摘要 5 篇、4+ 人 3 篇，第三人始终全场共享 3 篇；完整动态摘要成功注入并完成请求后按回应者冻结到稳定前缀，跨场不继承、不扩大来源权限。Character Knowledge 独立于退役 Memory4，按 Campaign／Owner／Target／fact／来源修订隔离并在发送前复核。用户本轮只交付代码、自动化验证和 GitHub 上传，不执行真实 CK3／付费 Provider／Soak 或 GitHub Release。

> 当前候选为 V9.3.9，沿用 V9.3.7 年龄／亲属事实与 V9.3.6.3 旧档兼容合同。玩家固定历史为完整 Recent2、合法官方追忆和完整合法玩家关系事项簿；明确玩家历史分句可并用双人／三人最多 5 篇、4+ 人最多 3 篇时间摘要和跨目标共享最多 3 篇第三人历史。2／3／4+ 人预算为 65%／70%／75% 和 80,000／84,000／96,000 Token 上限，实际受 Provider 当前余量限制。超限时先压缩较旧对话；完整来源仍放不下则 transport 前暂停，并展示所需、可用和分项预算。上下文提示按配置窗口动态、逐对话和逐回应者隔离、逐轮更新，并区分估算与最近请求实际用量。当前入口由 README.md 和 docs/README.md 索引；V9.3.7 `9caffe6` 远端失败保留为历史证据。
>>>>>>> Stashed changes

# 文档目录维护规则

## 目录职责

- docs/README.md 是分类、推荐阅读顺序和当前版本入口的唯一索引。
- 根目录 README.md 负责项目简介、安装运行和当前基线；根目录 CHANGELOG.md 只维护版本顺序、用户可见摘要和详细文档链接，不复制完整实现记录。
- docs/V8阶段开发记录.md 是 V8.0 起的连续阶段记录；docs/README_摘要系统.md 维护当前 `Legacy Summary` 标签、兼容的 3.0 协议与 2.5 存储合同及摘要召回边界。
- 当前文档入口跟踪 V9.3.7 修复候选，链接到 `V9_3_7_IMPLEMENTATION_REPORT.md`、`V9_3_7_VERIFICATION_REPORT.md` 和 `V9_3_5_INDEX_AND_SOURCE_CONTRACT.md`；V9.3.4 及更早报告保留历史证据。原候选本地证据与本轮复验分开，GitHub 9caffe6 发布回归已失败；后续修复见 V9_3_7_FOLLOWUP_REPORT.md，实机与外部验收单列，最终映射、构建、部署和测试状态以本轮报告为准，不得预填数量。真实 CK3、游戏内 Provider、Soak 尚待验收；远端 CI 按 SHA／run 记录真实结果，不能宣称 Full Freeze；不得将 ACK 或静态通过写成效果验收通过。
- V6/V7 阶段文档和 V8.3 历史文档仍是历史证据。若功能已退役，应在当前入口标注历史/废止，不因整理而删除文件或破坏旧链接。

## 编写规则

- 当前候选写作统一为 V9.3.7 年龄／公开亲属事实，并沿用 V9.3.6 玩家中心记忆、人物历史记忆 UI `Legacy Summary`；正式 Core/App/UI 版本号以包元数据和最终报告为准。Workshop 2.0.5、协议 3.0、摘要存储 2.5、Official Action 2.0.3 和独立 Three-Mod 1.0.6 保持。不要宣传 Memory Engine 4.0 在线功能。V9.3.4 报告保留为历史快照；候选实现、验证和来源合同分别链接 [实施报告](current/v9/V9_3_7_IMPLEMENTATION_REPORT.md)、[验证报告](current/v9/V9_3_7_VERIFICATION_REPORT.md)和[索引与来源合同](current/v9/V9_3_5_INDEX_AND_SOURCE_CONTRACT.md)。不要预写尚未确定的最终 PASS 数量或映射数量。

- 只记录仓库中实际存在、已经实现或明确标注为限制的内容；区分“代码/自动化通过”和“真实 CK3、Provider、Electron、远端 CI 或 Soak 已验收”。
- 新文档沿用仓库已有的版本、阶段、主题和 implementation-report/review 命名风格；不要为了统一而重命名历史中文文件或另造根目录版本散文档。
- 变更记录应写明受影响路径、数据/IPC/Prompt 合同、验证命令、证据范围和剩余人工 Gate。不要把截图、日志、存档或 API 凭据复制进仓库。
- 摘要文档必须同时说明当前可见标签 `Legacy Summary` 和底层兼容合同：既有协议 3.0、2.5 存储格式、字段与迁移边界保持兼容。每位回应 NPC 的固定历史只锚定当前玩家：最近 1 篇 Legacy、合法官方追忆、预算内尽量完整的玩家关系事项簿。固定文本首次构造后冻结；第三人仅提名为 L0，不读取其历史索引或原文；明确历史关系询问为 L1，每目标至多 16 条事项、零原文；具体历史经过为 L2，共享预算内至多 2 篇经来源键和修订号复验的摘要。2／3／4+ 人采用 16%／18%／20% 与 4800／5600／6400 Token 上限，并取无记忆 Prompt、输出预留及 Provider 安全余量允许的较小值。索引和解析不新增模型提取请求。历史 Legacy 可在所选范围唯一可信 Campaign 绑定时离线确认回填本地派生索引，未绑定或歧义保持只读，原摘要不修改；旧 archive Sidecar 惰性保留且运行时不读写；Legacy Forget ledger 使用原 index 及现有事务。改名合并若包含 Sidecar 则跳过，但纯 Legacy 摘要读写继续。
- 摘要/人物 UI 必须用真实姓名作为人物主标签；未知时显示姓名未载入提示，ID 和 source key 等技术字段只留在内部或折叠诊断，不能数字 fallback。来源全文必须先由后端校验来源键与期望修订号，过期时提示刷新；不按日期、行号或客户端路径盲跳。回填必须预览后明确确认，取消确认不写入。
- 世界线/关系文档必须保持 CK3 当前事实只读、Current Runtime Truth 优先、Definition↔Runtime 一对一绑定、冲突 fail-closed 和来源完整性边界；不要把历史人物资料写成当前游戏事实。
- UI 文档要注明三主题内部键 parchment/knight/ink 与玩家名称“游牧”/“骑士”/“水墨”的映射，并记录可读性、背景覆盖层和视觉验证范围。
- 设计文档、实施报告和审查报告不可互相冒充：方案是预期合同，实施报告是代码结果，审查报告还要标出未完成的人工 Gate。

## 验证

从仓库根目录检查文档引用、工作区状态和差异：

~~~powershell
rg -n "\[[^]]+\]\([^)]+" README.md CHANGELOG.md docs --glob '*.md'
rg -n "V8\.8\.3|V8\.8\.2|Memory Engine|Current Runtime Truth|游牧|骑士|水墨" README.md CHANGELOG.md docs --glob '*.md'
git status --short
git diff --check
~~~

确认新建或移动的文档确实存在，链接没有指向删除的模板、源码或构建产物。只改文档时不需要运行 Electron 或 CK3；若报告同时修改代码，仍须遵守根目录及对应子目录的测试要求。

本轮状态入口为 current/v9/V9_3_7_FOLLOWUP_REPORT.md。旧批次 PASS、Provider PARTIAL、人工 NOT_RUN 和已发生的远端 FAILED 分开记录；不得用“尚待验收”掩盖已知失败。历史说明可保留，当前入口须注明替代关系，不再重复旧的“当前版本”。
