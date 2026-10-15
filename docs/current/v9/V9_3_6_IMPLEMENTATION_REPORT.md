# V9.3.6 实施报告

状态：施工中。规格为 `V9_3_6_DETAILED_IMPLEMENTATION_SPEC.md`，基线 `03dfc4efe2791b31f28f4a4d521d41a10b59f6b9`。不代表真实 CK3、Provider 或远端 CI 已验收。

## Phase 0：基线

开工时工作区干净，285 source／artifact／deployed 映射一致，V9.3.5 payload 为 `41acdd5896978b94a6d198fec45ef0052fd05eabfcbe34cd38f309ccd9d2a9a4`。本轮使用相同 payload 的既有隔离 Windows 副本跑完整发布回归，407／407 组通过；未以正在修改的工作区冒充基线。

五项实际模块负例见验证报告。前两类路由及事项上限为必现；Forget 缓存残留依赖调用方漏传活动会话；Official 重叠字段仅为条件性风险，正常 MemoryEngine 输出没有同时返回两份 Official。

## 实施边界

只调整读取、冻结前缀及预算；Legacy、Pair Index、Forget、信件和官方追忆来源保持。Durable／Memory4／Year／Life 和旧 Sidecar 仍退役或惰性保留。既有离线回填与文件夹 UI 不更换存储格式。阶段实现、最终 payload、提交和验收结果随实际证据补充。

## Phase 1：玩家锚点与查询身份

`pair-memory-routing.js` 分离可信玩家 Anchor、当前 speaker/query 和当前玩家消息授权。固定 Counterpart 只由真实玩家 ID 决定；当前 speaker 仍可为其他 NPC，不覆盖它的动态语义。Conversation 传入 turn manager 的实际 playerMessageId、turnEpoch、会话和场景；同一玩家轮次中多个 NPC 依次回复仍共享该玩家请求，过期消息和 NPC-only 文本不授予第三人权限。第三人分类器及有限追问合同先由独立专项覆盖，读取接入属于后续阶段。
