# V9.4 验证记录

日期：2026-10-21。状态：**PARTIAL／停止发布验收**。本记录区分静态、离线模拟、真实 Windows 启动与外部实测；设计和历史版本 PASS 不作为当前候选 PASS。

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

依赖核验已通过 5,981 文件／264 包。重启后最终 build、verify、deploy、verify --deployed 均通过，306 项源码／构建／部署哈希一致，App 9.4.0，payload SHA256 为 `c2ebf5d768a155c2a54359a58344d11a046128809a065532711c1507317e3647`。receipt 在 `.build/runtime-deploy-state/receipt.json`，本次部署只替换 3 项相对前次有变化的资源；部署备份目录末段为 `8f6262a9-2fd6-427a-9346-82ea9c74d3b8`。

全量 `test-release.js` 此前停止于来源路径回归；诊断性 remainder 运行亦被重启打断。它不构成完整发布 PASS。后续全量应优先在隔离 Windows CI 上串行执行并绑定准确 SHA；本轮本机不再启动大型测试。远端 CI 尚无本候选通过证据。

## Windows EXE

重启前真实冷启动已执行，完整分发复制核验通过（6,359 文件、340,434,704 字节），但原安装目录和隔离副本均在主进程／Renderer 调试端点建立前退出，代码 `2147483651`／`0x80000003`。去除调试参数仍复现；stderr 无可用错误。故启动门禁为 **FAIL**，不是静态 PASS，也不能用旧 V9.3.9.3 的 UI 验证代替。

证据保存在忽略的 `.build/v9.4-construction/windows-smoke*.log`、`no-inspector-diagnostic.json` 及 smoke-temp 内 evidence.json。事件日志访问受限，尚未定位故障模块。未修改 ACL、Defender 或系统安全策略；用户重启后尚未重新验证 EXE，不假定重启已修复。

## 性能与外部验证

重启后以单进程重新执行离线双人七组测量：每组预热 10 次、配对采样 100 次，旧版到当前候选 build P50 增加约 0.541–0.721ms，P95 增加约 0.588–1.553ms。当前 Plan 源指纹为 `ecc21b2bdcdf6b2ae5258dc1fe0065c05f70517987c3ed454bab2ed3654fb653`，详细数据在忽略的 `.build/v9.4-construction/performance.json`。增加了本地组装成本，尚未签署性能验收阈值；不代表端到端提速、真实磁盘来源成本或 Provider 缓存收益。128K／192K、多人数性能和真实网络延迟尚未测量。

| Gate | 当前状态 |
|---|---|
| V9.4 离线专项 | 上述 14 个新增专项串行通过，后续三组历史回归／语法／主题合同通过；静态 package smoke 未在重启后重跑 |
| 完整本机发布回归 | FAIL／中断，非完整 PASS |
| 准确 SHA 的 Windows CI | NOT_RUN |
| Windows EXE 冷启动 | FAIL；重启后未重跑 |
| 实际桌面键入／焦点／穿透 | NOT_RUN |
| 真实付费 Provider | NOT_AUTHORIZED；没有调用 |
| 真实 CK3／ACK／长时间 Soak | NOT_RUN |

不得发布正式 V9.4 或宣称 Full Freeze，直至必需门禁分别签署。
