# V9.4.1 验证记录

2026-10-21。当前状态：**代码与自动化 Gate A／B／C 通过，真实环境 Gate D 未完成，候选**。基线为 `e6bdc711dc2624e1447a44a49e0041882a274d2a`；V9.4 的 486 组 CI 和六次 GLM 付费请求仅是历史证据，不能冒充本版通过。根因、来源等级与 UNKNOWN 债务见[实施记录](V9_4_1_IMPLEMENTATION.md)。

## 红绿与专项

在修改生产代码前运行新增 V813 专项，确定失败：`main-system-stable_global` 的实际 kind 为 DYNAMIC_WORLDLINE，期望 GLOBAL_STATIC。只在原安全提升点及可信分段点登记语义后，扩展后的 54 个场景通过，包括 V813 普通／空／长记忆、fullName 安全占位、动态变量、回应者交换、伪造 semanticKind、七布局与非流式／流式最终 preflight。

新增来源专项先失败于真实来源只读投影不存在，再实现投影与 sidecar 后通过：真实 key／revision 可在进程内追踪、无修订或 legacy locator 为 UNKNOWN、Scope 不符拒绝、同正文不同 revision 的诊断身份不同、SOURCE_BOUND 不跳过旧 verifier、provenance 篡改被 Seal 拒绝、旧 Plan 无该字段仍可序列化，以及 Provider payload／持久诊断无原始 key 或正文。

独立静态审查另外提供两条对抗夹具，均由根代理单进程先复现失败再验证修复：第一条发现旧复合 key 仍可枚举，改为 sidecar 留原 key、投影只留不可枚举的作用域 HMAC；第二条发现基线记忆快照身份被用于当前用户／历史／世界线等无关来源，改为只允许四个实际基线记忆类型标记 SNAPSHOT_DERIVED，其他无绑定者 UNKNOWN。两项同时纳入正式来源专项，独立夹具亦通过。

本机 Node 22.23.3、堆上限 384MB、独立长 TEMP，一次只运行一个测试进程。15 组串行相关专项全部 exit 0：

- 两个新增 `test-v9.4.1-{v813-static-classification,source-provenance}.js`。
- V9.4 static-first-order（21 布局／记忆场景）、plan-schema、deferred-main-span-source、serializer-spans、legacy-layout-golden（7 布局完整旧消息）。
- frozen-dynamic-lifecycle、knowledge-forget、responder-isolation；真实 MemoryEngine→PromptBuilder 的来源绑定、首次 pending／成功／复用、实际注入与未发送区分继续通过。
- provider-effective-request（7 个离线 Adapter）、cache-evidence、conversation-plan-main-chain、budget-preflight、replay-audit。

上述 Provider transport 为模拟，主链中的撤销和失败夹具允许预期错误输出；以最终断言与退出码判断。没有真实付费请求。清单实际输出为 616 个测试文件、488 个发布组、127 个历史归档；清单数量不是完整执行 PASS。主题读取层、Official Action 基线、前端内容合同与测试清单校验另行串行通过。完整 CI 结果在下文按实际运行补记。

## V9.4 差异与性能

从 git e6bdc71 提取仅 Main／shared 源码到忽略的 `.build/v9.4.1-construction/baseline-e6bdc71`，与当前代码在同一个 Node 进程中配对测量；不是完整分发复制。七布局 × 普通／空／长记忆，共 21 场景，各预热 10 次、交替顺序采样 100 对。原始匿名数值位于 `.build/v9.4.1-construction/performance.json`。

- 21 场景的 legacy／shadow 共 42 次逐字节对照均一致；V9 授权角色／正文集合、消息数与 Token 总量保持。只有 V813 两类 × 三记忆场景的默认 V9 排序改变。
- 最终源码 build P50 差值范围 −0.0165 至 +0.1322ms，P95 −0.2027 至 +0.4330ms，均为本机一次采样，无稳定提速结论。
- 六个 V813 场景的本地稳定前缀候选均增加 27 Token。普通 query 为 619→646，成功冻结为 659→686；空记忆为 548→575，长记忆分别为 6620→6647、6660→6687。指标仍是 LOCAL_ESTIMATE，不等于 Provider 原生命中。
- 未测本版真实 Provider 延迟、缓存命中、多人 Soak 或真实磁盘来源负载。V9.4 原有命中数据不挪用。

## 工程与外部 Gate

依赖核验通过 5981 文件／264 包；标准 build／verify／deploy／verify --deployed 已通过，306 项源码／生成物／部署哈希一致，App 9.4.1。payload 为 `89dd26ec7cac078d52f743c342947e1242acf9eb6a20b0c4ddf6f7127af8bc58`；receipt 位于 `.build/runtime-deploy-state/receipt.json`。首次沙箱构建曾在目录原子改名处遇到 EPERM，扩大执行范围后按原标准工具完成，不改 ACL 或防护。独立静态复核在两项对抗修复后未发现新源码阻断项。准确 SHA `d1479dbba9b584ccc8d71787b430a29b068e243b` 的 [Windows CI 39579976545](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39579976545) 已全部通过：**488 组完整发布回归、306 项构建部署与完整 EXE 冒烟**。远端 payload 与本机 89dd26ec… 完全一致，日志已逐项复核。此后验收文档补记不改变生产 Runtime。本机不再执行完整分发复制、大型目录故障套件或多套并发回归。

本轮完整分发复制核验为 6359 文件／340442415 字节；两次真实 Electron 35.1.5 启动均报告 App 9.4.1、Renderer ready、Preload 存在、版本 IPC 返回 9.4.1。合成 PCM 实际解码为 32 samples／8000 Hz／单声道；两次均观察到完整分发目录的 ffmpeg.dll 为 LOADED，locale pak 匹配。首次正常退出 code=0，重启使用同一隔离 profile、不同 PID，两个进程正常退出；不能将这些自动化结果等同用户桌面键入、焦点或空白穿透通过。匿名附件见 [CI artifact](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39579976545/artifacts/12336152273)。

| Gate | 当前状态 |
|---|---|
| P1 专项、跨布局、旧 Golden | PASS，见上述实际结果 |
| P2 来源／隐私／旧 verifier 与生命周期专项 | PASS；部分来源仍明确 UNKNOWN／快照级 |
| 306 项构建部署一致性 | PASS，payload 89dd26ec…，App 9.4.1 |
| 完整 Release Regression／精确 SHA Windows CI | PASS：d1479db／39579976545，488 组 |
| 完整 EXE 冷启动、重启、IPC、媒体与 DLL | PASS：同 SHA 隔离 Windows Runner 两次启动；本机结果不据此改写 |
| 用户本机新版启动／桌面输入 | NOT_RUN；保留 V9.4 历史环境失败，不假定已修复 |
| 本版真实 CK3、动作 ACK、信件投递 | NOT_RUN |
| 本版付费 Provider | NOT_RUN；本次施工不新增付费请求 |
| 多人长程 Soak | NOT_RUN |

只有代码与自动化 Gate 全部通过后才记录自动化修复完成；真实环境未验收时继续称候选，不签署 Full Freeze。
