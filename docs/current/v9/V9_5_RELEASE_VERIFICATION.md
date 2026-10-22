# V9.5.0 候选发布验证

日期：2026-10-23。开发基线 `713e9f614ab233fc3e9d0041cbb93018a54f6886`；Core/App/UI **9.5.0**，Workshop 2.0.5、Official Action 2.0.3、协议 3.0 和摘要存储 2.5 保持。

本机已完成 runtime-dependencies（5981 文件、264 包）、build、verify、deploy、verify --deployed。**346 项映射**，Payload SHA256：`1a800b12bda2e750174a7bdf0452d0dd0451cf351ca5637a50655f364958e3c2`。部署替换 55 项，原资源备份保存在 `.build/runtime-deploy-state/backups`。未清理用户数据。

初次沙箱构建原子重命名遇到 EPERM；同命令获准后成功。部署保护检测到后台 VOTC；用户明确退出并同意继续部署后，仅结束经路径核实的本安装进程，再完成部署。未绕过关闭保护。

世界记忆实机报告修复：原 `仍在` 检测错误拦截“宋金战事仍在持续”。现在仅对紧邻的受控事件名词与延续谓语例外；人物当前所在地、生死等结构化门禁继续有效。完整原文、姓氏“曾”、跨人物分句、无标点混排、单独年份和英文 now 边界均有专项。错误提示双语且可操作，未替用户写入记忆。

追加端到端回归已通过：在临时合成战役内使用实际 CanonService 保存并回读完整历史叙述，确认并非仅通过字符串分类。未连接用户真实战役或修改真实记忆。

| Gate | 当前状态 |
|---|---|
| 契约、异步、三语言、旧 DOM、Main scope、Provider 模型归属专项 | PASS，详见异步验证记录 |
| 单 Chrome 真实 Renderer 入口 + 匿名 Preload | PASS，八域/三主题/双语/焦点；无外部请求和效果调用 |
| DeepSeek 交付与生命周期 | 22/22 与 3/3 PASS |
| 源码构建、本机部署一致性 | PASS，346 项哈希一致 |
| 全量发布与完整 EXE | 等待本次准确 SHA 的隔离 Windows CI，旧版绿色不替代 |
| 本机 EXE 实际输入/鼠标穿透、真实 CK3 保存、Soak | NOT_RUN / USER_CONFIRMATION_PENDING |
| 新真实 Provider 请求 | NOT_RUN；本轮无新增付费调用 |
| 同机性能 A/B | NOT_MEASURED |

V9.5 保留候选状态，不签署 FULL FREEZE；旧页面少量复杂诊断/结果文案尚未完全双语化。新工作区是只读数据接入，原编辑、来源复验和审批继续由原业务容器执行。
