# V9.4 验证记录

日期：2026-10-21。状态：**自动化门禁 PASS／外部验收未完成，保留候选**。本记录区分静态、离线模拟、真实 Windows 启动与外部实测；设计和历史版本 PASS 不作为当前候选 PASS。

最新已签署自动化证据：[Windows CI 39562096181](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39562096181)，准确 SHA `0a42161f352c72739a58719bbc59975d89450311`。依赖核验、306 项构建／部署、**486 组完整发布回归、完整 EXE 冷启动与重启、界面／Preload／版本 IPC、实际媒体解码与分发目录 DLL 加载、正常退出均 PASS**。payload `759019e100cc0689868a0e0c540611e4eef75048ad73e4e57820c178dccbfc14` 与本机一致。以下前五轮失败保留原 SHA 历史归属，不改写为 PASS。

## 本机资源限制与重启恢复

用户报告此前并发测试导致电脑死机并强制重启。重启后检查未发现残留 Node／VOTC 测试进程；未完成的全量日志保留，不据此宣称全量通过。后续只由根代理一次执行一个测试进程，Node 堆上限设为 384MB，测试临时目录隔离到项目 `.build/v9.4-construction/resume-temp`。独立审查仅静态阅读，不另开测试。暂停本机大型复制／故障恢复测试及 EXE 再启动。

## 已执行结果

Node 22.23.3 x64 来自官方发行包，临时放在忽略的 `.build`；未全局安装或持久修改环境。重启后串行通过的 V9.4 专项：

- schema、serializer spans、static-first order、deferred-main spans；静态排序覆盖 21 个布局／profile × 记忆场景，完整消息集合、anchor 和输入 Token 保持。
- frozen-dynamic lifecycle、knowledge／Forget、responder isolation、legacy layout Golden；Golden 固定到 2330bbc 的七组完整消息，不用候选输出自我生成期望。
- 七个离线 Adapter 的有效请求、budget preflight、replay audit；均为模拟 transport，未调用真实付费 API。
- 真实 Conversation + PromptBuilder 的主链、日期／知情撤销与受控续写；cache evidence V2 原生／派生／未知、隐私、失败排除和 TTFT。
- source-path boundary 的确定性夹具：隐藏 junction、缺失叶节点、悬空链接、扩展／UNC 路径及大小写敏感条目。
- 测试清单校验：614 个 test 文件归类、486 个 release groups、127 项历史归档。清单是编排数量，**不是 486 组已通过**。

旧 `test-v9.3.6.2-candidate-directory-qa.js` 在原基线与最初候选均复现共享 Owner junction 漏检。改用原生 realpath 后已越过该失败断言，但后续合成目录还原／清理遇到 `EPERM`／`ENOTEMPTY`，整组仍为 **FAIL／环境阻塞**，不能记 PASS，也未跳过断言。

旧布局／前缀测试显式使用 legacy 模式，继续验证原顺序、V1 合同与既有阈值；新默认 V9 顺序由独立专项覆盖。Zhipu 旧原生用量测试同时核验 V1 字段不变与新增原始证据；取消测试等待实际 fetch 状态，而不假定固定微任务时序。重启后串行重跑 `test-v9.2.3-glm-native-usage.js` 通过；`test-v9.2.1-glm-v813-prefix.js` 在普通沙箱因夹具原子改名 EPERM 失败，申请扩大执行范围后 12/12 通过；随后 `test-v9.3-independent-qa.js` 18/18 通过，无跳过。UI 主题合同与八个部署模块语法检查亦通过。

## 构建与完整门禁

依赖核验已通过 5,981 文件／264 包。重启后 build、verify、deploy、verify --deployed 均通过，306 项源码／构建／部署哈希一致，App 9.4.0。初始构建 payload 为 `c2ebf5d768a155c2a54359a58344d11a046128809a065532711c1507317e3647`；补齐真实冻结回调及旧 lifecycle 枚举后，最终 payload 为 `01e6336ff3aa215a05ecac32493963d51f3d1fb758503a693b772699b5444444`。receipt 在 `.build/runtime-deploy-state/receipt.json`，最后一次部署备份目录末段为 `f46cf9f2-2a9e-41bc-9bfa-ccdc9bf689e2`。最终部署后串行重跑旧 World Facts、21 组静态排序／枚举、真实冻结回调、Conversation 主链与六组大窗口预算均通过。

全量 `test-release.js` 此前停止于来源路径回归；诊断性 remainder 运行亦被重启打断。它不构成完整发布 PASS。本轮本机不再启动大型测试，完整门禁转隔离 Windows Runner。

首轮 [Windows CI 39543056777](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39543056777)，准确 SHA `0f5d2fe8132db17b8bb37d5adf00437f7754026a`：依赖、构建、部署通过；发布回归 **FAILED** 于 `v9.3.9-independent-qa`。原因是该测试依赖的 `makePromptRuntime.build` 夹具未向 PromptBuilder 转发显式 legacy 模式。已补齐第四个可选参数，并在隔离 TEMP 中串行重跑该组通过；默认调用行为不变。后续准确 SHA 全量结果单列，不能将此轮失败覆盖为成功。

第二轮 [Windows CI 39543612831](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39543612831)，准确 SHA `b292c453d092160a730d0f197acc4503d9209390`：构建／部署通过；完整应用两次冷启动、界面／IPC、合成解码、分发目录 ffmpeg.dll 加载及正常退出 **PASS**。发布回归 **FAILED** 于 `v9.3.5-pair-ledger` 的路径别名拒绝。后续工作流将 TEMP／TMP 隔离到项目 `.build/ci-temp` 长路径，保持来源 junction 负向断言不变。当前路径守卫对无法证明为同一字面目录的短名别名采取拒绝；不增加 Win32 原生扩展来放宽此边界。

第三轮 [Windows CI 39544193023](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39544193023)，准确 SHA `08bcb16f57f1ecd61b0b8940c5e16df22afe7808`：已确认 Runner 原 TEMP 为 `C:\Users\RUNNER~1\AppData\Local\Temp`；隔离后越过该问题。构建 payload 与本机完全一致，完整应用两次启动／媒体加载通过。发布回归 **FAILED** 于 `v9.3.4-independent-qa`：旧 fs 访问监视包装器丢失了 `realpathSync.native` 属性。已让包装器保留并同样监视 native 调用，未绕过旧存储访问断言；本机仅串行重跑该小型组，5/5 通过。

第四轮 [Windows CI 39544727775](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39544727775)，准确 SHA `8544cb4358627fd7c41d8b60238eb70d6c8df837`：完整应用两次启动及媒体加载通过；发布回归 **FAILED** 于 `v8.11-world-facts`，暴露 V9 把新的语义 kind 错放进旧 `block.lifecycle` 公开字段。修复保留原四种 lifecycle 枚举，新 kind 独立保存在 `semanticKind`，不改变 IR 的状态。新增 21 组默认 V9 输出枚举兼容断言；旧世界事实断言不修改。

补查真实成功回调时，新增测试先复现首次 V9 pending 来源未提交冻结的问题：此前生命周期测试直接调用 Engine 提交，遗漏了 Conversation 的块识别。已改为真实调用 `retainDynamicSummaryRecall`，修复 pending ID 接线及 committed-only 请求的来源声明；串行验证未发来源不提交、成功后冻结、次轮不重复召回／扣配额、混合请求只声明实际 pending。另补 128K／192K × 2／3／4 人的六组最终请求预算边界：完整合法记忆保留，额外动态数据超限时拒绝，禁止截记忆补救。均为纯离线夹具，没有真实 Provider 调用。

第五轮 [Windows CI 39546566951](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39546566951)，准确 SHA `d8287f17b122d649af3eb4c830dcec6c8f75cc0d`：新版真实冻结回调及枚举兼容回归通过，完整应用两次启动／媒体加载通过。发布回归运行至第 220 组，**FAILED** 于 `v8.14.1-frontend-content` 的窗口标题和三主题预览版本文字。已从源文件补齐 9.4.0，重新构建部署后该原始测试通过，未修改断言。

窗口标题补齐后的最新 payload 为 `759019e100cc0689868a0e0c540611e4eef75048ad73e4e57820c178dccbfc14`，306 项构建／部署再次核验一致；本次只替换 Renderer index.html，备份目录末段为 `a837afb2-f582-44b8-96f3-a37f1ba8361c`。01e 为此前冻结回调修复的历史构建。

## Windows EXE

重启前真实冷启动已执行，完整分发复制核验通过（6,359 文件、340,434,704 字节），但原安装目录和隔离副本均在主进程／Renderer 调试端点建立前退出，代码 `2147483651`／`0x80000003`。去除调试参数仍复现；stderr 无可用错误。故启动门禁为 **FAIL**，不是静态 PASS，也不能用旧 V9.3.9.3 的 UI 验证代替。

证据保存在忽略的 `.build/v9.4-construction/windows-smoke*.log`、`no-inspector-diagnostic.json` 及 smoke-temp 内 evidence.json。事件日志访问受限，尚未定位故障模块。未修改 ACL、Defender 或系统安全策略；用户重启后尚未重新验证 EXE，不假定重启已修复。

上述首轮远端 CI 中，完整复制、真实 main／renderer／preload／版本 IPC 及正常退出已通过，但整个启动门禁仍 **FAILED**：未观察到 ffmpeg.dll 加载。修订 smoke 后增加不播放、不联网的合成 PCM 解码，并查询 Electron 自有各进程的模块；继续要求实际从完整分发目录加载 ffmpeg，不能仅用静态文件存在代替。第二轮远端已通过两次实际启动及媒体加载。模块证据证明检查时应用进程加载了分发目录 DLL，不单独断言 PCM 解码是该 DLL 加载的原因。

## 性能与外部验证

最终源码以单进程重新执行离线双人七组测量：每组预热 10 次、配对采样 100 次，旧版到当前候选 build P50 增加约 0.444–0.626ms，P95 增加约 0.782–1.170ms。当前 Plan 源指纹为 `6c80cb33ff98b7df09f03a7b2e3741377baeb04d8e284e6f7309b602748de815`，详细数据在忽略的 `.build/v9.4-construction/performance.json`。增加了本地组装成本，尚未签署性能验收阈值；不代表端到端提速、真实磁盘来源成本或 Provider 缓存收益。128K／192K、多人数性能和真实网络延迟尚未测量；前述六组测试属于预算边界验证，不是性能测量。

| Gate | 当前状态 |
|---|---|
| V9.4 离线专项 | 上述 14 个新增专项串行通过，后续三组历史回归／语法／主题合同通过；静态 package smoke 未在重启后重跑 |
| 完整本机发布回归 | FAIL／中断，非完整 PASS |
| 准确 SHA 的 Windows CI | 0a42161／39562096181：486 组完整回归 PASS；前五轮 FAILED 历史保留 |
| Windows EXE 冷启动／重启 | 0a42161 隔离 Windows Runner 完整启动、媒体加载与正常退出 PASS；本机先前 FAIL 保留、重启后未重测 |
| 实际桌面键入／焦点／穿透 | NOT_RUN |
| 真实付费 Provider | NOT_AUTHORIZED；没有调用 |
| 真实 CK3／ACK／长时间 Soak | NOT_RUN |

不得发布正式 V9.4 或宣称 Full Freeze，直至必需门禁分别签署。
