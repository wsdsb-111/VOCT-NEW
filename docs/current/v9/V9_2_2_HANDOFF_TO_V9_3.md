# V9.2.2 向 V9.3 的移交边界

本轮是 [Durable 安全／诊断候选](V9_2_2_IMPLEMENTATION_REPORT.md)，缓存收益为 HOLD，未自动进入 V9.3。正式版本、Memory4 协议／摘要存储、七域端口、唯一 JSON 权威和既有 Action/Letter 幂等合同保持。

后续在用户选择的新真实测试窗口中主动开启既有诊断模式，退出前导出性能 JSON；将本地 Usage 与 `durableTrace` 按唯一 UUID 对账。先核对所有父／子／Provider 重试的 Token 和 UNKNOWN，再按 scope/policy/endpoint/settings 比较暖前缀。跨进程 HMAC 不可串联。

优先确认真实 event status 失败及 recovery 原因、长块截断是否重复输入、继续提取 transitions 的质量；不要以删除源、停止未处理承诺、放松 enum 或伪造原生缓存来改善百分比。若有直接证据再做局部 Token 软分块 A/B，并保留原 128 硬限及来源完整性。

最终提交的远端 CI、本轮 CK3 多人／换存档／Forget 操作、GLM 与 DeepSeek 使用、本轮 Soak 需独立验收；旧用户验收保留，但不替代候选的新 Gate。[基线](V9_2_2_BASELINE.md)、[台账](V9_2_2_P_ISSUE_LEDGER.md)、[验证](V9_2_2_VERIFICATION_REPORT.md)记录当前证据边界。
