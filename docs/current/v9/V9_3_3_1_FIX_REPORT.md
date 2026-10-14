# V9.3.3.1 修复实施报告

2026-10-14；基线 main `fc4f1c60a13b06d7daddac697e484db335f26647`。依据[用户提供的规格原文](V9_3_3_1_FIX_SPEC.md)实施四项修复，Core/App/UI 同步为 9.3.3.1。本地结果和远端放行分开记录，详见[验证报告](V9_3_3_1_VERIFICATION_REPORT.md)及[改动清单](V9_3_3_1_CHANGED_FILES.md)。

## FIX-01：二进制检出与首次部署

[原失败 Actions](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/38503719487)的 job 日志确认：Node 22.23.3 构建和 296 项校验通过，首次部署报 `build_deploy_initial_target_unknown:out/main/chunks/icon-BljXrxwL.ico`，未执行完整 release。

用相同基线在本机全新 Windows 检出、`core.autocrlf=true`、没有 `.build` 或 receipt 的条件下复现相同错误。Git blob 与可信 src 输入均为 46,292 字节；检出图标变为 46,445 字节，首个差异在 offset 45。原属性把图标作为文本，153 个单独 LF 被增加 CR；不是生成器或原始 icon blob 损坏。

`.gitattributes` 对 `resources/app/out/**` 默认使用 `-text !eol`，仅明确的 JS/JSON/HTML/CSS/MD/HBS/SVG 类型使用文本 CRLF。13 个实际受管二进制（ICO、11 PNG、OTF）保持原 blob/input bytes，无资产重写或全仓 renormalize。LFS filter/diff/merge 和 frozen src/Prompt 字节约定保留。新增 Git 原生 filter 回归验证现有资产及未来二进制扩展名。

`seedInitialReceipt`、`assertRuntimeInventory`、workflow、原子部署和 hash/parity 逻辑未改动。修复后的全新 Windows 检出完成首次部署，图标 blob/checkout/staging 三方一致；完整结果见验证报告。新 main SHA 尚未推送，远端 CI Gate 仍未关闭。

## FIX-02：Legacy–Durable 同源身份

独立基线 QA 为 8/10 PASS、2 FAIL：同 Owner/Campaign 的不同 conversation 复用 message/segment ID 会误报共享来源；同页其他摘要的合法谱系可以给目标行背书。没有证据表明存在跨 Owner 正文泄漏。

`memory4-coverage.js` 将谱系限制为 `summaryId → factId → verified lineages`。共享关联依次核对 Owner/Campaign、summary 的 Conversation/Finalization、当前 fact 的权限/hash、fact 已声明身份及局部谱系，再检查可信消息/片段交集。summary/fact 顶层与 provenance 的身份冲突立即拒绝；旧 fact 未保存独立身份时，只能经合法父摘要和明确包含该 fact 的已验证谱系关联，不能仅凭重复 message ID。

Forget、sourceRevision、Legacy hash 和既有 `createProjectionLineage` 验证继续执行。`LEGACY_SOURCE_EXACT` 的 legacyRefs/sourceHash 路径保持独立；无法证明共享来源时保守分类。Durable-only 与 provenSourceLinkedCount 仍使用同一分类器；`semanticEquivalence: NOT_ASSERTED` 不变，无磁盘写回或模型请求。

独立 QA 扩充 summary/fact × conversation/finalization 冲突、来源编辑、revision、Forget、scope、合法 shared/exact 等场景，原生 Windows writer 下 12/12 PASS。删除测试 fixture 对原子 writer 的直接写入绕过，没有用复制替代生产 writer。

## FIX-03：当前分页与缓存

旧版 95 条合成事实的生产 React 事件测试证实：offset 40 请求返回后仍渲染 offset 0。现按 summary ID 保存 active offset，页缓存仅存数据；显示 0–39、40–79、80–94 的 40/40/15 行，尾页禁用下一页，返回不会进入展开/收起逻辑。

收起保留当前页；Owner、刷新、Campaign/上下文失效与 STALE 清空缓存和 offset。为防后台编辑/Forget 后旧页闪回，返回缓存页前发送一次 limit=1 的只读来源校验，校验通过后复用原 40 条缓存；验证期间隐藏旧行，失败则撤回该缓存页。该安全取舍增加本地 IPC 读取，不调用 Provider，也不在 DTO 内加入正文。

独立审查补出的“缓存认证失败后旧页重新露出”已先在旧产物复现（throw、success=false 两例均红），再修复并覆盖重试。快速返回、收起、摘要/Owner/Campaign 切换和旧响应均有事件级测试。

## FIX-04：详情导航与 Loading 所有权

旧版成功 `getMemory4Entry` 导航到 Detail 后，主动递增 tab selection 使 finally 无法释放 Loading，已记录基线失败。现在当前有效请求先释放 Loading，再切换 Tab；新增共享 request token 配合 context/sequence/tab 校验，旧请求不能清掉新请求的 Loading，也不能迟到导航。

正文仍由 `getMemory4Entry` 单独认证，携带 expectedIndexRevision/expectedEntryRevision/expectedBodyHash。成功、STALE、throw、Tab/Owner/刷新/unmount、两个详情响应乱序及成功后立即刷新均通过。完整事件组 20/20 PASS，真实打包窗口也验证分页、正文跳转、按钮恢复和缓存撤回。

## 四段版本的必要启动兼容

规格要求的 App `9.3.3.1` 被 vendored electron-updater 的 SemVer 解析拒绝。真实隔离 VOTC 启动未出现 Renderer；随后用真实 SDK 构造器复现 `ERR_UPDATER_INVALID_VERSION`。已有 fork policy 明确 `autoUpdateEnabled: false`，但 constructor 仍访问 lazy `autoUpdater` getter。

仅在禁用时提前返回，避免实例化原本禁用的 SDK；不修改依赖、解析器或版本字符串，不启用更新、不联系 release Provider。现有 updater isolation 组新增原 SDK 拒绝四段版本与 disabled getter 初始化次数为零的反例，修复后真实打包版本/窗口通过。Provider 黄金测试只更新明确的 App/Core 版本头预期，其他请求字节仍严格比较。

## 保留边界

Durable Planner、8 条上限、提取 Policy 9.3.3、coverageProof、Store 唯一 writer、Recovery/CAPPED、Prompt/cache anchor、Provider/GLM/Action 生产逻辑不变。Memory 4.0 显示、3.0 协议、2.5 存储、Workshop 2.0.5、Official Action 2.0.3 和 Three-Mod 1.0.6 保留。

本轮零付费、零真实会话发送、零历史重提取；没有运行 Year/Life `--apply`，没有删除用户数据、恢复记录或备份。没有自动推送、重写 main、创建主仓库分支/worktree；测试快照只位于忽略目录。CK3/测试存档人工验收、Soak 和最终 SHA 远端 CI 不由合成回归冒充。
