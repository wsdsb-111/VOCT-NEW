# V9.2 → V9.3 阶段移交

日期：2026-10-11。V9.2 处理应用服务边界与 scoped JSON 读取/恢复护栏；V9.3 的唯一功能阶段主题是 Provider Platform。当前最终部署为 286 mapping／418 groups，本地全量及 Summary folder 合并专项、隔离窗口冒烟通过；远端 CI 和 CK3/Provider/Soak 仍未完成，因此此文记录的是拟移交边界，不代表已签发 V9.2 formal complete。完成状态、P0 关闭证据和测试门禁以 [实施与验证报告](V9_2_VERIFICATION_REPORT.md) 和 [P 级问题台账](V9_2_P_ISSUE_LEDGER.md) 为准。

## V9.2 留下的稳定边界

- Main 是组合根；七个语义 Port 委托已有 Conversation、Presence、Memory、Worldline、Action、Letter 与 Persistence owner。真实调用链、签名、错误和 side effects 由现有 owner 保持。
- Presence 仍属于当前 Conversation 的状态；Memory Engine/Coordinator 保持 Forget 与恢复权威；Repository 不宣称拥有记忆引擎恢复、遗忘或 Legacy 孤儿删除能力。
- Memory4 仍以 Campaign × Owner 授权；候选查询返回带 Scope、revision 与 index hash 的 frame，只有重新验证后才按需读取有限正文。JSON、engine protocol 3.0、summary storage 2.5 保持兼容。
- 已有 version 1 summary mutation journal（兼容原 files 并增加可选目录记录）和原 MemoryStore recovery 作为恢复权威。路径/链接/base64 预验证不得擅自升级 journal 版本、绕开既有事务、或把逐文件替换称为跨文件原子事务。
- Repository 审计显式调用、只读、匿名且最多检查 1,000 条。Legacy OrphanAudit 和用户确认 Forget 链保持原样，不作为启动任务。

## V9.3 Provider Platform 工作范围

按照 [V9 总路线 §7.4](V9_ROADMAP.md)，只在完成 V9.2 Gate 后统一实际使用的 Provider Adapter 合同：能力声明、普通/流式生成、Structured Output、Result/Usage/Reasoning/FinishReason、取消/超时、429/5xx 与不支持能力。端点和用户当前配置决定真实支持名单，不预设模型名永久有效。

V9.2 保留现有 `player2`、`openrouter`、`openai-compatible`、`ollama`、`deepseek`、`gemini`、`zhipu` 入口及其适配器。既有流式 Provider 必须保留 usage-only 尾块，Gemini `usageMetadata` 继续统一记账；没有 usage 的端点只能产生明确标为估算的 Token。OpenAI-compatible 的 Action Schema 标准/兼容传输模式继续分开；DeepSeek 专属 Action 优化配置不能覆盖 Zhipu GLM 推理强度或 `clear_thinking`。这些都是本轮固定的兼容合同，不代表各模型端点经过本轮实测。

每个 Provider 的成功、错误、取消、usage-only 尾块、usage 缺失、结构化响应和流式终止要有确定夹具。只有服务商明确返回的数据才可称真实缓存命中；无法验证的 token、缓存和 TTFT 维持明确 UNKNOWN/估算标签。凭据仍留在现有 provider-specific 配置边界内，不进入通用诊断或持久化 Repository。

## 不随移交提前扩大的范围

V9.3 不重排 Prompt blocks/cache anchor（V9.4）、恢复 React 源码或做英文 UI（V9.5）、统一 CK3 Bridge/Workshop Mod（V9.6），也不做全局遗留代码退役。不得在 Provider 合同工作中改变 Memory scope、Forget、Action ACK、Letter receipt 或 Worldline 的事实权限。

## 版本与基线

本阶段文档与目标发布版本为项目 V9.2、App 9.2.0。Workshop Mod 2.0.5、Memory Engine 显示 4.0、协议 3.0、摘要存储 2.5、Official Action 2.0.3 与独立 Three-Mod 1.0.6 沿用。V9.1 基线 commit `f9c088ff384597fa9e07db248a6cc8c6be68113e` 的远端 Release Regression run `38117263132` 已核验 Success；用户在 2026-10-11 确认此前功能正常，该反馈为未量化 `USER_CONFIRMED`，不等同于 V9.2 的 Provider 或性能 Gate。

Summary folder 合并的备份、Campaign、Tombstone／冲突负例、恢复及最终 Runtime／418 groups 已完成本地验证。进入 V9.3 前仍须复核最终 SHA 远端 CI 与所需实机 Gate；未执行的 CK3、Provider 与 Soak 按 [V9.2 实施与验证报告](V9_2_VERIFICATION_REPORT.md) 显式记录。
