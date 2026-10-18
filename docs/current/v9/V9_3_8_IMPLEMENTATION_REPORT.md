# V9.3.8 实施报告

状态：V9.3.8 本地实施及完整自动门禁收口完成。最终单行玩家 UI 版本的 290 项 build、stage verify、deploy 与 deployed verify 全部通过，payload `deaa67f4c38c9f4845426bdeb36e59a2478d09f0c282a93fb9ad12aa85ea10da`。独立 VM QA 和 6 张原生窗口视觉图通过；UI 只显示一行、usageRevision 可抵御同时间／时钟回拨事件、不累计其他 NPC、空快照会清空；提示完整保留 Prompt 语义，formal-context 检查通过。原生窗口证据覆盖 3 个主题的 1280×900 与 700×900，最终窄宽布局无重叠／裁切；540×420 的早期截图不作为 PASS。网络尝试、Provider 调用和发送 Prompt 均为零，CK3 未调用、隔离 profile 未写 APPDATA，验收结束时 VOTC/Electron 均已关闭。完整发布回归最终 session 8943 exit 0，日志 `.build/v938-release-final3.log`，末行为 `VOTC Release Regression: PASS (446 groups)`。此前三轮失败及测试／接线修正保留在下表；181 组为过期测试版本正则，应用和 renderer 实际版本均已是 V9.3.8。清单库存为 574 tests、446 release groups、127 historical entries。Provider 原生用量验证未执行；真实 CK3、游戏内 Provider 和 Soak 仍为 PENDING，远端 CI 按用户要求暂缓（NOT_RUN）。V9.3.7 SHA `9caffe6` 的远端失败仍为历史记录；本地自动门禁通过不代表 Full Freeze。

## 目标与兼容边界

本候选收口玩家历史记忆的完整性、多人预算与当前请求上下文提示。Core／App／UI 版本以包元数据及最终收口记录为准。Workshop Mod 2.0.5、Official Action 2.0.3、Memory 协议 3.0、摘要存储 2.5／schema 2 和既有目录格式保持兼容。Legacy、Source、Forget、Campaign、NPC→NPC 合法定向写入及身份边界保持；不恢复 Durable、Year/Life 自动生成、恢复或后台重建。

V9.3.7 的实现、验证与失败批次继续作为历史证据保留。尤其 `9caffe6` 远端发布回归失败属于该 SHA，不推导本轮 CI 结论；本候选远端状态须按实际 SHA 和 run 记录。

## 已批准的记忆行为

每位回应 NPC 的固定玩家历史完整包含最近 2 篇 Legacy、合法官方追忆和完整合法玩家关系事项簿。Recent2 来源不得静默裁剪，合法 ledger 条目不得因预算拥挤而省略；固定文本首次构造后冻结。其他历史读取仍须有明确玩家历史分句授权，并沿用现有 Owner、Campaign、Forget、source key 与 revision 校验。

获准的明确玩家历史分句可同时使用最多 3 篇时间摘要和最多 3 篇第三人历史摘要；第三人摘要的 3 篇上限由全部目标共享。L0 仅提名，不访问第三人历史索引或原文。不得新增模型检索／提取请求，也不得让其他 NPC 发言自动扩展固定玩家历史。

2／3／4+ 人预算分别采用当前配置上下文窗口的 65%／70%／75%，以及 80,000／84,000／88,000 Token 硬上限。每次请求的实际可用预算取以下限制中的最小值：比例预算、人数硬上限、扣除非记忆 Prompt 与输出预留后的窗口空间，以及 Provider 当前真实可用安全余量。上下文窗口按当前用户配置读取；当前配置为 128k，数值不得写死。

若完整记忆与请求超过可用预算，先通过现有机制压缩较旧对话。压缩后仍无法完整容纳时，必须在 transport 前暂停该请求，并在界面展示所需预算、可用预算和各记忆组件预算。不得静默裁剪来源、丢弃 Recent2、漏掉合法 ledger，或以估算的 Provider 余量假装可发送。

## 上下文用量提示合同

对玩家只显示一条低干扰的“本场对话上下文”，呈现当前或最近一次实际请求的 usage 与 remaining；不按 NPC 逐行展示，也不把不同 NPC 的 Token 用量相加。显示的是按当前容量计算的每请求快照，不是服务商服务器端的“剩余 Token”查询。后端仍按当前对话和回应者隔离数据以保证正确性，旧对话或旧回应者的异步事件不得覆盖当前显示。容量窗口按配置动态读取，并标明来源是用户设置、服务商 metadata 或回退值；当前用户配置为 128k，不得硬编码。

请求生成期间将当前请求用量标为临时估算。请求结束后优先采用该次请求的 Provider 原生 input/output 用量；缺失字段继续用估算并明确标注。剩余上下文空间由已标明来源的容量窗口和这份请求快照计算，不代表 Provider 账户或服务器的剩余额度。不能把历史累计值、其他 NPC／对话数据或临时估算表述为本轮原生用量。

## 验收记录

以下按已收到的本轮证据更新；未执行或尚无证据的结果继续标为 NOT_RUN／PENDING。

| 验收项 | 状态 | 记录要求 |
| --- | --- | --- |
| 玩家记忆召回源码与专项回归 | PASS | `scripts/test-v9.3.8-full-memory.js` 通过；V9.3.6 兼容回归含 69 项行为检查、14 项路由、10 项第三人检索和 6 项事项簿检查；另有 6 项重生成、20 项时间、6 项 Strict Recent 去重及 Provider final guard 检查通过 |
| 独立记忆对抗探针 | PASS | `.build/qa/v938-adversarial.js` 覆盖 full2+3+3、精确去重、L0/L1 拒绝、数字未来年份和超限；本地验证未调用付费 API，也未写入 APPDATA 用户数据 |
| 此前源码构建与 stage verify | PASS（已被后续改动取代） | 当时 V9.3.8 的 290 项映射通过严格源码构建及 stage verify；日志 `.build/v938-final-build-runtime.js.log`、`.build/v938-final-verify-runtime-build.js.log` |
| 首次候选部署（历史尝试） | BLOCKED | 部署器检测到旧 receipt（payload `05871d99e3b52e1442b322129ab17ccc2ea367ec259409b122f7d0f2929709da`）与当前 known HEAD `37df16e5763d4764c451268ad96356fa9bfda848` 的目标资源不一致，安全停止；失败日志保留于 `.build/v938-deploy-runtime-build.js.log`。后续单行 UI build/deploy 已通过，见本表相应验收项 |
| 已部署资源核对与隔离基线 bootstrap | PASS（范围受限） | `.build/v938-bootstrap-known-head.cjs` 将 290 项现有部署资源逐项核对到同一 known HEAD 的源文件、生成 blob 或 Git 过滤后的 checkout 字节（其中 7 项受 checkout EOL 影响），并完成全量 inventory。正常 build/bootstrap 在隔离且已验证的基线上生成 payload `38b84ebd1695ff76967313b6eebeae2a80761a3337d315f6932adeb407cd7caf`；旧 receipt 保存在 `.build/runtime-deploy-state/receipt.json.v937-stale-1792292733908`。基线记录见 `.build/v938-baseline-bootstrap.log`。未手改 receipt 内容或绕过门禁；用户 APPDATA 未触碰。这不等同于 V9.3.8 候选部署 |
| 此前构建、部署及部署后 verify | PASS（已被后续改动取代） | 290 项映射通过，23 项变化；payload `5773fee5f0d06d4ba7ef5321277869f5db9239a1ab5547575b1e294b1974cd1a`。日志：`.build/v938-final-build-runtime.js.log`、`.build/v938-final-verify-runtime-build.js.log`、`.build/v938-final-deploy-runtime-build.js.log` |
| conversation-port 修复与部署独立 QA | PASS（中间版本） | 修复 conversation ports 与 IPC 接线后，源和部署独立 QA 通过；中间 payload `79b7dd…`，已被下述单行 UI build 替代 |
| 上下文后端语义与 responder 动态探针 | PASS | 后端仍按对话与回应者隔离；取消／新轮重置竞态和实际 `respondAs` 动态探针通过。生成中估算、请求结束后优先原生 input/output、缺失字段估算及容量来源标识已按流程检查；未做付费真实 Provider 验证 |
| 单行上下文 UI 构建与部署 | PASS | 290 项 build、stage verify、deploy、deployed verify 全通过；payload `deaa67f4c38c9f4845426bdeb36e59a2478d09f0c282a93fb9ad12aa85ea10da`。日志：`.build/v938-single-build-runtime.js.log`、`.build/v938-single-verify-runtime-build.js.log`、`.build/v938-single-deploy-runtime-build.js.log`、`.build/v938-single-deployed-verify.log` |
| 独立 VM UI QA 与 formal-context | PASS | 确认只显示 1 行；`usageRevision` 防同时间及系统时钟回拨事件；不累计其他 NPC；空 snapshot 会清空显示；tooltip 保留完整 Prompt 语义；formal-context PASS |
| 原生窗口视觉 QA | PASS | 根 agent 与 UI agent 逐图复核 6 张截图，索引为 `.build/v938-context-usage-native-iD6RJW/evidence.json`：3 主题 × 1280×900 桌面及 700×900 窄宽。显示单条 128000 快照；indicator 相对布局高 45.69px。700×900 的 `narrowChat` bounds 为 `[10,10,690,890]`，overflow bottom 为 359px、composer top 为 711px，无重叠／裁切。540×420 早期面板截图不纳入 PASS。`networkAttempts=[]`、`providerCalls=[]`、`promptsSent=0`；CK3 未调用、隔离 profile 未写 APPDATA，验收结束时 VOTC/Electron 已关闭 |
| Provider 原生用量验证 | NOT_RUN | 本次原生窗口 QA 未调用 Provider，也未发送 Prompt，因此没有真实服务商 input/output 用量验证 |
| 完整回归首次尝试 | FAILED | `.build/v938-release-complete.log` 在 68 组因 service-port 漏接失败；修复后的 conversation ports／IPC 源与部署独立 QA 已通过 |
| 第二次完整回归与旧测试合同修正 | FAILED → targeted PASS | `.build/v938-release-final.log` 在 102 组因 `test-v8.15-production-contract-qa` 仍断言 8K 摘要应整篇省略而失败，该断言与 V9.3.8 新合同冲突。仅测试修正为验证 8K 摘要完整进入 Prompt；18 倍 filler 超比例额度时要求 `MEMORY_CONTEXT_OVERFLOW`、`needed > available`、`thirdPerson > 0` 且原文不变。定向 PASS，日志 `.build/v938-production-contract-qa.log`；source/runtime 未改，UI payload 保持 `deaa67f4c38c9f4845426bdeb36e59a2478d09f0c282a93fb9ad12aa85ea10da` |
| 第三次完整回归与旧版本断言修正 | FAILED → targeted PASS | `.build/v938-release-final2.log` 在 181 组因 `test-v8.14.1-frontend-content.js` 保留旧 `V9.3.7` 正则而失败；应用文案和 renderer 实际版本已为 V9.3.8，故属测试断言过期。仅更新该测试正则，定向 PASS；扫描当前 tests 未发现其他同类旧正则。source/runtime 与 payload 未改 |
| 最终完整发布回归 | PASS | session 8943 exit 0；`.build/v938-release-final3.log` 末行为 `VOTC Release Regression: PASS (446 groups)`。完整清单为 574 tests、446 release groups、127 historical entries |
| 发布清单库存 | RECORDED | 574 tests、446 release groups、127 historical entries；库存计数与 session 8943 的 446 组 PASS 分开记录 |
| 真实 CK3 | PENDING | 外部人工 Gate；静态回归不替代 |
| 游戏内 Provider | PENDING | 按 Provider 与实际请求记录原生用量、估算边界及阻断行为 |
| Soak | PENDING | 记录运行时长、环境和具体结论 |
| 远端 CI | NOT_RUN（按用户要求暂缓） | 本轮不触发远端 CI；V9.3.7 `9caffe6` 的历史失败保持原归属，不代表 V9.3.8 |

本候选在相应证据补齐前不宣称 Full Freeze。V9.3.7 的旧 PASS、PARTIAL、人工未执行状态和 `9caffe6` CI 失败均保留原归属，不并入 V9.3.8 统计。
