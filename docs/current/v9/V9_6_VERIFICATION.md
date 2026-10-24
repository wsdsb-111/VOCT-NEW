# V9.6 验证记录

日期：2026-10-24。Core／App／UI 9.6.0 候选；独立 Mod 基线 2.0.5（官方上游 2.0.4），Bridge revision 1。自动化与真实 CK3／Provider／Soak 分开签署。本轮没有新增付费请求，没有上传 Steam，没有修改真实存档、日志或用户队列。

## 本机证据

- Node 22，`NODE_OPTIONS=--max-old-space-size=384`；测试串行，一次一个 Chromium，未执行本机完整分发复制或全量发布门禁。
- 四项新增发布组：`test-ck3-bridge-contract.js`、`test-v9.6-bridge-service.js`、`test-v9.6-bridge-ui.js`、`test-v9.6-bridge-integration.js` 均通过。
- 合同：8 个合成夹具、9 项能力、6 个功能；覆盖旧无 Hello、不同基线版本、正常声明、缺失能力、不支持协议、未知可选／必选项。
- 会话：启动 EOF、旧 Hello、重复 LOAD token、新 generation、token 不匹配、畸形 Hello、独立绑定状态、日志换路径／轮转／截断／同尺寸改写、固定 stat 时间下的 LOAD 边界改写、分块读取及只读载体哨兵。
- 生产接线：未知旧 Mod 沿原检查；明确不兼容在排队释放／写入前阻断；Action／Letter 提前检查；缺少回读能力不能把 ACK 标记为 CONFIRMED；旧 generation 不能供应本次确认；排队跨载入后按实际写入 generation 观察。重检不更改载体，Preload 不转发客户端路径／写参数。
- 连同上述四项，共 14 个受影响专项串行通过：Run Command 队列与恢复、Gold confirmation／no optimistic state、Letter startup receipt／date session、official recollection scope、deferred Main span、三主题背景及 Official Action 系统。
- 原页面离线浏览器通过：8 页、中英、三主题、1280／1024／853 CSS 像素视口；Bridge 原诊断页读取和只读重检使用显式匿名 mock，无 Provider／Prompt 写入、业务 Effect 或外部网络请求。此项不等于原生桌面 DPI／人工输入验收。
- 依赖锁验证通过：5981 文件、264 包。Runtime 构建／验证／部署：352 项；最终 payload 与指定 SHA 的 CI 结果在下节补记。
- Mod 源与候选验证通过：97 文件、12,996,288 字节；实际安装快照对源码为 96 个字节相同、1 个文本差异（新增 Hello）。源码对固定上游仍为 19 个规范化文本差异、63 个 BOM／换行差异、10 个字节相同、5 个本地新增及 3 个上游仓库元文件。
- Mod payload 树 SHA：`d3bd9b0ecca796f5cbe404672e3b10ff2fbb1ad51fb31698f51f4f0a1ede58fd`；定义见[实施报告](V9_6_IMPLEMENTATION.md)，不是 ZIP 哈希。安装中的 Workshop 文件未替换。

初次测试发现缺字段错误码与预期不一致、固定 stat fixture 的 fs getter 不可赋值，以及诊断 API 缺失时空值解引用；已修复并重跑通过。独立只读 QA 又发现绑定状态误推断、过晚工作流检查、入队／写入 generation 混用、跨载入回读确认及实时官方追忆门禁问题，已补充针对性修复与反例。没有放宽业务断言。

## CI 与打包

首个实现代码 `997d936ea9c4ae079ba833289b83f6ecf22248f5` 的 [Windows CI 40081254379](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/40081254379) 已通过 **509 组完整发布回归、352 项构建／部署、独立 Mod 产物核验及完整 EXE 冷启动／重启／媒体加载**。该批 Runtime payload 为 `18e873f8d053e35af9db2da3d764bfe3c2289ad297f726d7054f68b9a6e6358f`，与该批本机部署一致。

诊断修正代码 `71bc7126f14d2eb3e3546d3b6df682039ddface0` 的 [Windows CI 40083703532](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/40083703532) 同样通过 509 组、352 项资源、独立 Mod 产物及完整 EXE 冷启动／重启／媒体加载；该批 payload 为 `230af51f05de657d7ca37913437ab2059759978044c23421af4ff8d0f1d16e5c`，与该批本机部署一致。三主题中英原诊断页六张匿名截图位于本机 `.build/v9.6/visual/`；已检查水墨英文与骑士中文的文字可读性和背景显示。

收口只读 QA 又发现两处未被首批夹具覆盖的边界：仅动作不可用时异常会误伤已经生成的台词；同命令金币回读后的余额刷新期间换载入，旧 verification 仍可能提交。现已将不可用的动作评估局部跳过，保留聊天，并在余额刷新 await 后再次验证 generation。新增反例先证明金币回读本身可 CONFIRMED，再在异步刷新内切换 LOAD，必须得到 UNCONFIRMED 且不记录旧验证。接线、金币确认和真实 respondAs 台词重生成专项通过；最终 payload 为 `2832fdc42cddcd486dad0e2e99b58af731088af330133c6113cc2dcb78c4fcdf`。独立 QA 已只读确认这两项关闭，未冒充其亲自运行测试。

最终代码 **`f38bb52bf4a237307656a456a2c015947fa7aa76`** 的 [Windows CI 40085792003](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/40085792003)（job `120848336125`）已通过 **509 组完整发布回归、352 项构建／部署校验、独立 97 文件 Mod 候选构建核验、完整 EXE 冷启动／重启／媒体加载**。冷启动与重启 runtime exception 均为 0；最终 Runtime payload 与本机部署一致。该 SHA 是最后一次代码修订，之后的验证文档提交不改变 Runtime 或 Mod payload。

旧 V9.5.1 的 505 组及 EXE 成功不充当本版证据。本机 V9.5.1 的 0x80000003 历史失败保留，不由浏览器或远端成功替代；V9.6 本机未复制完整 EXE 做真实桌面输入验收。

## T1—T6 边界

| 层级 | 状态 | 证据边界 |
| --- | --- | --- |
| T1 静态／来源／合同 | PASS | 独立清单、来源处置、合成夹具、Hello 一行最小改动 |
| T2 Runtime 单元／接线 | PASS | 当前 generation、只读检测、分功能检查、原业务回归 |
| T3 跨端合成兼容 | PASS | 合成声明与旧路径；不证明 CK3 引擎实际发出 Hello |
| T4 完整回归／打包 | PASS | 最终代码 `f38bb52`／CI 40085792003，509 组、352 项与完整 EXE 通过 |
| T5 真实 CK3／Provider | NOT_RUN | 新档、读档、游戏语言／Traits、Action／Letter 实机；本轮零付费请求 |
| T6 恢复／长时实机 | NOT_RUN | 合成恢复已测；真实游戏跨载入与 Soak 未签署 |

未完成的人工 Gate 不被候选版本号、静态哈希或 CI 冒充通过。执行清单沿用[实机计划](V9_6_CK3_LIVE_TEST_PLAN.md)中的安全与证据要求，其中统一打包原型已由本轮双模块独立分发方案取代。
