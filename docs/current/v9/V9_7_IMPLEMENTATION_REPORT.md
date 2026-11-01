# V9.7.0 Legacy Decommission 实施报告

2026-11-01，工程候选；依据 [工程方案](V9_7_DETAILED_ENGINEERING_SPEC.md)，基线及回滚见 [冻结记录](V9_7_BASELINE.md)。直接 main 开发，不改 Workshop 或独立多 Mod 兼容项目。

## 已实施

1. 完成函数/配置/IPC/数据权威审计和互斥状态台账。Prompt 旧布局/自定义脚本回退、七 Provider facade、Legacy/Pair/Forget、五代公开亲属、Canon、Official Action、Letter/ACK、Bridge 均有实际职责，保持原实现；未知动态/外部消费者的导出列 HOLD，不强删。
2. 仅退役 `providers/provider-result.js` 中 Gemini `max_tokens` 的不可达 else-if。通用 LENGTH 分支已先匹配该值；保留旧 options 属性读取及 String/toLowerCase 求值，因此 null、getter、coercion 的异常和副作用不改变。567 普通输入比对和 7 组 options 正反例对照冻结的 V9.6.1 函数。
3. 四组新增发布检查：引用/映射及未改 Runtime 字节、旧脚本 Prompt 模式边界、Provider finish 等价、真实 Legacy reader/Pair preview 的只读重启。全部原 519 发布组及 127 归档项保留，新清单为 523 发布组。
4. 离线审计工具记录 322 JS/504 字面相对 require、184 采样 Preload 路由/174 handler 与 Renderer 文本消费者，包含动态 Pair handler 循环。它不是完备调用图，未命中消费者不作为删除许可。
5. Core/App/UI 与 Bridge 的 Runtime 标签为 9.7.0；协议、Workshop、摘要和 Action 版本不变。root lock 元数据同步，不升级依赖。Provider Golden 夹具改读源码 package（它测试的正是源码 adapter），避免把旧安装的 User-Agent 版本误认作候选版本；冻结 wire Golden 不变。
6. 旧 V9.7 Workshop 一体化分发永久取消，下一阶段为新 V9.8 RC/Soak。当前路线、索引、台账和移交明确覆盖旧计划，历史原结论保留。

## 产物与边界

353 项隔离构建 payload：`a8d9305b3941c80f3155893ec97a71e0f5bed69c23fd73f8285dff26c5bd7567`。本机只写 `.build/runtime`；没有覆盖 `resources/app` 的 V9.6.1 安装，没有真实 userdata 迁移。全量 materialize/EXE 验证由准确 SHA 的隔离 Windows CI 签署，状态见 [验证报告](V9_7_VERIFICATION.md)。

没有实施的内容：大域重写、删除完整旧模块/IPC/配置键、恢复 Memory4、改变 Recent2/冻结/来源/Forget/4096、付费请求、CK3 实机和 Soak。保留兼容不是已证明所有外部调用安全退役；HOLD 项列入 [V9.8 移交](V9_7_HANDOFF_TO_V9_8.md)。

用户追加的文档合并归档与 V9.7 Runtime 变更独立提交；按 V6–V9 和小版本册整理，保留来源/版本/历史验证边界与旧章节入口，不删历史结论。
