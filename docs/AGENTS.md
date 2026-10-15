# 文档目录维护规则

## 目录职责

- docs/README.md 是分类、推荐阅读顺序和当前版本入口的唯一索引。
- 根目录 README.md 负责项目简介、安装运行和当前基线；根目录 CHANGELOG.md 只维护版本顺序、用户可见摘要和详细文档链接，不复制完整实现记录。
- docs/V8阶段开发记录.md 是 V8.0 起的连续阶段记录；docs/README_摘要系统.md 维护当前 `Legacy Summary` 标签、兼容的 3.0 协议与 2.5 存储合同及摘要召回边界。
- 当前文档入口跟踪 V9.3.5 Pair Memory Index 候选，链接到 `V9_3_5_IMPLEMENTATION_REPORT.md`、`V9_3_5_VERIFICATION_REPORT.md` 和 `V9_3_5_INDEX_AND_SOURCE_CONTRACT.md`；V9.3.4 及更早报告保留历史证据。候选仍在施工与验收阶段，最终映射、构建、部署和测试状态以本轮报告为准，不得预填数量。真实 CK3、Soak 与远端 CI 尚待验收，不能宣称 Full Freeze；不得将 ACK 或静态通过写成效果验收通过。
- V6/V7 阶段文档和 V8.3 历史文档仍是历史证据。若功能已退役，应在当前入口标注历史/废止，不因整理而删除文件或破坏旧链接。

## 编写规则

- 当前候选合同写作统一为 V9.3.5 Pair Memory Index、人物历史记忆 UI `Legacy Summary`；正式 Core/App/UI 版本号以包元数据和最终报告为准。Workshop 2.0.5、协议 3.0、摘要存储 2.5、Official Action 2.0.3 和独立 Three-Mod 1.0.6 保持。不要宣传 Memory Engine 4.0 在线功能。V9.3.4 报告保留为历史快照；候选实现、验证和来源合同分别链接 [实施报告](current/v9/V9_3_5_IMPLEMENTATION_REPORT.md)、[验证报告](current/v9/V9_3_5_VERIFICATION_REPORT.md)和[索引与来源合同](current/v9/V9_3_5_INDEX_AND_SOURCE_CONTRACT.md)。不要预写尚未确定的最终 PASS 数量或映射数量。

- 只记录仓库中实际存在、已经实现或明确标注为限制的内容；区分“代码/自动化通过”和“真实 CK3、Provider、Electron、远端 CI 或 Soak 已验收”。
- 新文档沿用仓库已有的版本、阶段、主题和 implementation-report/review 命名风格；不要为了统一而重命名历史中文文件或另造根目录版本散文档。
- 变更记录应写明受影响路径、数据/IPC/Prompt 合同、验证命令、证据范围和剩余人工 Gate。不要把截图、日志、存档或 API 凭据复制进仓库。
- 摘要文档必须同时说明当前可见标签 `Legacy Summary` 和底层兼容合同：既有协议 3.0、2.5 存储格式、字段与迁移边界保持兼容。当前候选为 Recent1 + 本地 Pair 事项索引及 1–2 篇经键／修订号复验的来源摘要；Temporal 与 Mentioned 各自最多 3 项，共享既有按参与人数冻结的 10%／12.5%／15% 和 3600／4500／5400 Token 总预算。索引和解析不新增模型提取请求。历史 Legacy 可在所选范围唯一可信 Campaign 绑定时离线确认回填本地派生索引，未绑定或歧义保持只读，原摘要不修改；旧 archive Sidecar 惰性保留且运行时不读写；Legacy Forget ledger 使用原 index 及现有事务。改名合并若包含 Sidecar 则跳过，但纯 Legacy 摘要读写继续。
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
