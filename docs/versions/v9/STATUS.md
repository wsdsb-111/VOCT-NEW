# V9.7 当前交付状态（2026-11-01）

本页汇总当前状态；[V9.7 版本册](V9.7.md) 各章是固定来源快照，章内的历史 PENDING/FAILED 不会因后来成功而被改写。

## 已实施与本机验证

- Core/App/UI 9.7.0；353 映射隔离构建通过，payload `a8d9305b3941c80f3155893ec97a71e0f5bed69c23fd73f8285dff26c5bd7567`。本机安装仍是 V9.6.1，不自动部署。
- 不可达 Provider 分支已退役；旧 options 的 null/getter/coercion 行为保留。原有完整模块、IPC/配置/数据格式、五代亲属、Legacy/Forget/Pair、Canon 4096、Action/Letter/Bridge 不删除。
- 原 17 项专项、CI baseline guard 与文档保留专项均已本机串行通过，Node 堆上限 384MB；manifest 当前为 653 test 文件、525 release groups、127 archived checks。原 519 发布组未降级。
- 文档 327 份正文合并为 V6–V9 的 35 册，另有 13 个连续阶段直达索引。327 原文 Git 集合、正文完整性、旧已识别锚点、相对链接目标及 988 个册间锚点核对通过。未知 fragment 不丢弃；本次观测源文链接未发现未知目标章节片段。跨 minor 全文仍在 OVERVIEW，各 minor 有准确章节入口。
- Terra/high 最终只读复核未发现明确 P0/P1；其审查不等同于执行测试。环境变量只用于防误用，不是无法伪造的隔离安全边界。

## CI 历史与当前待验

1. `b745936` / [41283699861](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/41283699861) FAILED：新构建通过，无初始部署回执且旧目标不同，保护拒绝；release/EXE 未执行。
2. `9449b0a` / [41285162334](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/41285162334) FAILED：冻结旧资源的 `AGENTS.md` 因 Git CRLF/LF 差异被严格哈希拒绝；release/EXE 未执行。
3. `dc83f65` 修复只限 CI 的旧资源核验：仅允许完整冻结哈希，或严格 UTF-8 且仅 CRLF→LF 后与冻结哈希一致；receipt 记录实际原字节哈希，目标文件不改。外来文件、未知正文和既有 receipt 仍拒绝。准确 SHA 的新 CI 尚待登记。

完整 release 与 EXE 冷启动/重启/媒体仅在隔离 Windows CI 执行。尚无新版本的真实 CK3、真实 Provider、本机输入、2h/100+ 回合 Soak；维持 `CK3_LIVE_PENDING / PROVIDER_LIVE_PENDING`，Soak 交 V9.8，不宣称 Full Freeze。

当前路线：旧 V9.7 Workshop 一体化分发取消，新 V9.8 为 RC/Soak。Runtime/Workshop 独立维护，本轮没有 Steam 上传、付费请求或真实数据迁移。
