# V9.2.1 候选向 V9.3 的边界移交

日期：2026-10-12。本轮安全与诊断改动可供审查，**G4 HOLD、G5 尚未通过，未授权自动进入 V9.3**。按 [旧总路线](V9_ROADMAP.md) 和用户 [缓存专项](V9_2_1_IMPLEMENTATION_SPEC.md) 继续分期。

## 保留合同

- 当前 GLM 仍走 v813，真实日期、角色状态、关系和授权记忆保持原动态与冻结失效规则；无跨 NPC 私有前缀共享。
- Durable 通用 System 不含额度、Owner、Campaign 或正文；User 尾部 limits 保留动态预算。每次出站前读取 Forget，截断二分和后续 chunk 不复活源片段；原提交和恢复权威不变。
- 原生缓存 0 是 0；未报告为 UNKNOWN；本地 hash/公共前缀估计不产生厂商 hit。clear_thinking 和 reasoning 配置保持现状。
- Store/Repository、Memory schema、Commitment、Action ACK、Letter receipt、Workshop 与 Three-Mod 均未修改。

## 后续证据

给 V9.3：原七 Provider 不重写。本轮 usage-only 尾块、0/positive/missing 与 endpoint-switch 负例可作为 Conformance 输入；DeepSeek baseline 第 2 个响应严格解析失败，只是实验停止证据，缺少拒绝码/原响应，不应武断归罪于厂商或放宽本地校验。

给 V9.4：固定/动态 Durable 结构和当前 v813 出站夹具、独立 history/experiment 报告可复用。96 个 GLM 请求没有 A/B 增益；历史约 23K context 与合成 1.6K–2.6K 不可直接比较。62 个同端点大估算前缀原生零以及 TTL/路由假说继续 UNKNOWN。

给用户 Gate：选择继续受控小实验或接受 HOLD 再进入 V9.3；最终提交 SHA 的 CI、CK3 功能与 Soak 独立记录。没有为用完 10 元预算扩大请求量。

## 回滚

V9.2 权威源码及运行资源已保留在用户批准的受限私有备份；公开基线为 commit `6026713`。回滚只恢复四个源码文件的 V9.2 内容，再通过 build→verify→deploy→deployed parity，不直接覆盖部分 out、不回滚记忆数据、不重放 Action/Letter。

既有 `.build/runtime-deploy-state` receipt 仅属于 Runtime 维护；不知道当前目标内容时保留 receipt 并停止，不能删除它强行部署。候选未签发发布，App/UI 版本暂保持 9.2.0/V9.2；满足规格 Gate 后再统一对齐 9.2.1。
