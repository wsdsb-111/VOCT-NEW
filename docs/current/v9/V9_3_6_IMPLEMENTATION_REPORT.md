# V9.3.6 实施报告

状态：施工中。规格为 `V9_3_6_DETAILED_IMPLEMENTATION_SPEC.md`，基线 `03dfc4efe2791b31f28f4a4d521d41a10b59f6b9`。不代表真实 CK3、Provider 或远端 CI 已验收。

## Phase 0：基线

开工时工作区干净，285 source／artifact／deployed 映射一致，V9.3.5 payload 为 `41acdd5896978b94a6d198fec45ef0052fd05eabfcbe34cd38f309ccd9d2a9a4`。本轮使用相同 payload 的既有隔离 Windows 副本跑完整发布回归，407／407 组通过；未以正在修改的工作区冒充基线。

五项实际模块负例见验证报告。前两类路由及事项上限为必现；Forget 缓存残留依赖调用方漏传活动会话；Official 重叠字段仅为条件性风险，正常 MemoryEngine 输出没有同时返回两份 Official。

## 实施边界

只调整读取、冻结前缀及预算；Legacy、Pair Index、Forget、信件和官方追忆来源保持。Durable／Memory4／Year／Life 和旧 Sidecar 仍退役或惰性保留。既有离线回填与文件夹 UI 不更换存储格式。阶段实现、最终 payload、提交和验收结果随实际证据补充。
