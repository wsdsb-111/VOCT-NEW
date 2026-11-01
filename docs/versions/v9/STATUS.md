# V9.7 当前交付状态（2026-11-01）

本页汇总当前状态；[V9.7 版本册](V9.7.md) 各章是固定来源快照，章内的历史 PENDING/FAILED 不会因后来成功而被改写。

## 已实施与本机验证

- Core/App/UI 9.7.0；353 映射隔离构建通过，payload `f6b679ed8aa59fcd9c74cc2ebc3889623e1ed0c365de01810ca5345989d623eb`。本机安装仍是 V9.6.1，不自动部署。
- 不可达 Provider 分支已退役；旧 options 的 null/getter/coercion 行为保留。原有完整模块、IPC/配置/数据格式、五代亲属、Legacy/Forget/Pair、Canon 4096、Action/Letter/Bridge 不删除。
- 原 17 项专项、CI baseline guard 与文档保留专项均已本机串行通过，Node 堆上限 384MB；manifest 当前为 653 test 文件、525 release groups、127 archived checks。原 519 发布组未降级。
- 文档 327 份正文合并为 V6–V9 的 35 册，另有 13 个连续阶段直达索引。327 原文 Git 集合、正文完整性、旧已识别锚点、相对链接目标及 988 个册间锚点核对通过。未知 fragment 不丢弃；本次观测源文链接未发现未知目标章节片段。跨 minor 全文仍在 OVERVIEW，各 minor 有准确章节入口。
- Terra/high 最终只读复核未发现明确 P0/P1；其审查不等同于执行测试。环境变量只用于防误用，不是无法伪造的隔离安全边界。

## 准确代码 SHA 验收与 CI 历史

1. `b745936` / [41283699861](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/41283699861) FAILED：新构建通过，无初始部署回执且旧目标不同，保护拒绝；release/EXE 未执行。
2. `9449b0a` / [41285162334](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/41285162334) FAILED：冻结旧资源的 `AGENTS.md` 因 Git CRLF/LF 差异被严格哈希拒绝；release/EXE 未执行。
3. `dc83f65` / [41286183575](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/41286183575) 与文档提交 `ce73a74` / [41286289986](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/41286289986) FAILED：旧源码含 CRLF、旧资源 Git blob 为 LF，单边归一化仍无法证明。未绕过正文保护。
4. `8703e40` / [41286919315](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/41286919315) FAILED：已完成基线采用、353映射隔离升级及完整 EXE 检查；发布回归发现 Bridge 诊断界面仍显示9.6.1，补齐单行版本常量后专项通过。
5. **`f26394a53160a39618d3ebba7b84e062b379c683` / [41287454791](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/41287454791) SUCCESS**：525组完整发布、353项 source/artifact/deployed parity、97文件独立Mod产物验证、完整 EXE 冷启动/重启/IPC、PCM媒体解码32样本/8kHz/单声道、en-US locale pak和正常退出 code0全部通过。新payload如上，与本机构建一致；这不是本机新版本部署。

CI基线采用只在隔离checkout显式执行：先从3721固定Git源码取回353份原始blob并逐个匹配冻结原始SHA，再比较双方严格UTF-8的换行归一化指纹。receipt记录目标实际字节；完整清单、未知正文和已有receipt仍拒绝。本机沙盒用353份真实旧Git资源复核采用和目标哈希通过，无完整分发复制。

七个源码映射发生变化：六项仅版本标签，一项Provider不可达分支；其余346项保持基线原字节。Terra/high已逐项审查这七项diff，没有以按文件白名单代替实际审查。原V9.7冻结章节中的初期6项/a8d9305b…为对应阶段证据，当前以本页为准。

**工程候选完成；安装与外部 Gate 独立。** 当前 main 后续仅更新验收文档时，以上通过归属于准确功能代码提交，后续文档CI按其自身SHA核对，不把历史成功改记为其它SHA。

完整 release 与 EXE 冷启动/重启/媒体仅在隔离 Windows CI 执行。尚无新版本的真实 CK3、真实 Provider、本机输入、2h/100+ 回合 Soak；维持 `CK3_LIVE_PENDING / PROVIDER_LIVE_PENDING`，Soak 交 V9.8，不宣称 Full Freeze。

当前路线：旧 V9.7 Workshop 一体化分发取消，新 V9.8 为 RC/Soak。Runtime/Workshop 独立维护，本轮没有 Steam 上传、付费请求或真实数据迁移。
