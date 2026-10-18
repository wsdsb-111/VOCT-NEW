# V9.3.9.1 跨电脑交接记录

交接时间：2026-10-18。用户因额度不足要求停止本机后续验证，转到下一台电脑继续。**本轮尚未完成全部验收，不能写成全量 PASS。**

## 1. 从哪里继续

- 项目：`D:\VOCT-NEW`。
- 分支：`codex/v9.3.9.1-disclosure-fix`。
- HEAD／修复基线：`a8b1f31d1b536dfeda312a8d474ec5dde61a287a`，V9.3.9。
- 修改仍在工作区，**没有提交、没有推送**。新增源码、测试及本文目前都是未跟踪文件，不能仅复制 `git diff` 或只切换分支。
- Core／App／UI 已改为 `9.3.9.1`；Workshop 2.0.5、Official Action 2.0.3、协议 3.0、摘要存储 2.5 保持。
- 详细代码说明见 [实施报告](V9_3_9_1_IMPLEMENTATION_REPORT.md)。本文件是停止时的准确进度；报告中的待验证项需由后续执行结果更新。

## 2. 用户最终要求，优先于旧文档

1. 只恢复当前对话人物之间的认知显示、玩家手动特质披露及原有知情行为；不为了 UI 重构 Worldline 认知。
2. 认知按听众 Owner → 目标 Target 分开保存；A 私下告诉 B，不代表 C 知道。
3. 公开发言中的明确披露，应分别写给所有实际在场听众。三人及以上场景同样如此。候场、迟加入、暂时缺席不追溯获知，私语仍限指定接收者。
4. 外貌／身体自动可见沿用现有白名单，白名单外的特质不能见面就全部暴露。
5. 当前可靠、公开的父母子女及亲兄弟姐妹关系允许免披露互知特质，包含公开同父异母／同母异父；继亲、配偶或单纯家族标签不授权。未暴露的真实私生亲属关系不授权。
6. 姓名、头衔、称号经常漏记，是本次重点。称号 `nickname` 已属于公开描述白名单，不能因认知 UI 恢复而隐藏。
7. V9.3.9 摘要召回、冻结、配额、预算、来源权限等保持不变。不要恢复 Memory4／Durable／Year／Life／Sidecar 在线链路。
8. 不连接 GitHub、不修远端 CI；不跑真实 CK3、付费 Provider、Soak 或 GitHub Release。
9. 年龄 +1 没有实机截图、日期和原始导出，用户只确认“NPC 回复比实际年龄多 1”。不得统一减一，不得宣称真实案例已证实修复。

## 3. 已修改内容

### 人物认知与披露

- 新增 `src/app/main/conversation/character-disclosure-extraction.js`：复用历史确定性提取思路，纯本地识别精确当前候选，不发模型请求、不扫描 Worldline。姓名、头衔、称号分别为 `NAME`／`TITLE`／`NICKNAME`；原始 Character 的 `primaryTitle`、`titleRankConcept`、`heldCourtAndCouncilPositions` 均纳入头衔候选。
- 支持“我叫…／我的名字是…／在下…”等明确姓名自述、带逗号及后续提问的复合介绍、明确称号与当前头衔自述。疑问、否定、未来、传闻、旁白、错误说话者和同名歧义不当作披露。转述须有说话者自己的合法知情依据。
- 新增 `character-disclosure-store.js`：只保存对话披露和手动特质状态到 `VOTC_DATA_DIR/character-knowledge/disclosures-v1.json`。按 Campaign／Owner／Target／fact 隔离，绑定消息修订、事实指纹、听众与日期；编辑／删除原话会使依赖的转述失效，循环转述不能自证。手动写入校验会话、来源令牌和 expectedRevision，原子落盘。
- Main 已撤下 V9.3.9 `worldline/character-knowledge-service.js` 的生产接线，改为对话记录适配器。旧模块及旧 `records-v1.json` 保留，不迁移、不删除、不当作原始对话证明。
- `conversation.js` 认知目标由全部人物 ID 改为本场参与者及明确涉及人物；补上完整玩家发言、完整成功 NPC 回复和编辑／重新生成后的披露记录与撤销钩子。原召回、预算和冻结方法不改。
- `trait-profile-selector.js` 恢复旧版本原生 `knownSecrets` 的准确 Owner→Target 特质依据，并保留人工隐藏优先。新增 `getAutomaticTraitAccess`，仅通过当事人的明确父母／子女指针和 `Map.get` 复用严格当前亲属来源门禁，不建全人物图；同场白名单及公开直亲为直接可知。
- 已修复“合法 otherParent + SECRET／旧快照重复项”可能升级授权的漏洞，候选整体必须有效且一致。
- **最后一笔源码修复**：明确 `STEP` 继亲标记（外层 reference／嵌套 proof／otherParent）不得进入直亲特质互知。仅认知 selector 改动，不改原有关系图。专项已通过，但尚未部署、未完成独立 QA 复核和全量回归。

### 前端、IPC 与年龄

- 摘要管理区域始终挂载当前对话认知面板，无历史摘要也可用。分别选择“谁知道／关于谁”，不默认选人；真实姓名展示，同名不同 ID 隔离。
- 普通特质可定向标记已知／未知；直接可见白名单与公开直亲不显示无效的隐藏按钮。姓名／头衔／称号为只读卡片，称号公开可见。
- 补齐过往遗漏的 `NICKNAME` 卡片过滤；同场新消息会重读已选 Pair 的新披露，切场清空旧选择，异步迟到结果有请求序号与 scope 护栏。保存期间刷新延后。
- 新增 `characterKnowledge:getConversationView` 与 Preload 桥；原三组 Owner／Target／manual IPC 名称保留，加入 conversationId 校验。服务端拒绝非本场人物和过期写入。
- `character-profile-v2.js` 仅移除稳定资料中的年龄行，防止缓存年龄与本轮动态年龄并列冲突；解析、动态当前年龄及历史摘要文字不变。合成“缓存 18、当前 17”已复现并修复，**不能据此认定昨晚实机 +1 根因**。
- README、CHANGELOG、文档索引及六份可编辑 AGENTS 已补当前范围说明；生成的两份 AGENTS 随正常构建同步。

### 未改动的核心

`src/app/main/memory-system/`、`summaries/`、`worldline/`、`game-data/` 和 `prompts/prompt-builder.js` 与基线无源码差异。Recent2、time5（2／3 人）／time3（4+ 人）、全场 third3、65%／70%／75%、80k／84k／96k、按回应者冻结及来源复核保持。部分生成文件在 `git status` 显示修改只是基线换行字节差异，不能据此误判摘要业务被修改；没有手改生成代码绕过构建。

## 4. 验证状态：哪些通过，哪些没有

| 项目 | 停止时状态 |
| --- | --- |
| Runtime 依赖 | PASS：5,981 文件、264 包，vendor 未安装／更新 |
| 六项新增专项 | 提取、store、UI、年龄 Prompt、母亲身份、trait-access 均曾通过；最后 STEP 修复后 trait-access 再次 PASS，其余尚未统一重跑 |
| 独立对抗 QA | 原 22／22 PASS；随后额外发现 STEP 边界，源码已修，但独立 STEP 夹具尚未按修复后断言重跑 |
| 母亲身份 P2 | 当前公开父母证据下、妻妾无彼此关系时，现有家庭事实回答正确；缺失／秘密／过期证据保持未知。未修改亲属生产实现 |
| Provider 专项 | 39 个黄金出站场景、7 个离线适配器 PASS；只允许随当前包版本改变版本头部 |
| 主题／官方动作专项 | PASS |
| 最近一次已部署资源 | 298 项 parity PASS，payload `dd648d2f4735c94bb0b05d272da6a236e8b7c73dca3ddcfe0b8faba72353814a`，**未包含最后 STEP 修复** |
| 停止前在途构建 | 已自然完成 PASS，298 项，payload `f1bb6cf5fa73762695b21995eb5338647583ee32f25c53175076aabc4f1bb06e`；**尚未 verify／deploy** |
| 完整发布门禁 | **未通过**。当前库存 458 release groups、127 historical entries；最近运行停在第 190 组 `v8.14.1-trait-profile-routing` |
| 隔离打包窗口 | 已验证真实 IPC 保存、重启后单 Pair 手动状态保留、另一听众不继承、白名单可见，以及 NAME／TITLE／NICKNAME 为两位实际听众落盘；最终 UI 全流程未完成 |
| 最终截图 | **未完成**。早期截图空黑，已定位临时窗口失焦被既有 overlay 规则隐藏；不得把该截图当视觉 PASS。修正测试保持可见后尚未最终复跑 |
| 真实年龄 +1 | NOT_CONFIRMED，缺实机同日期分层数据；P1 完整发布门槛未签 |
| GitHub／实机／付费服务／Soak／Release | NOT_RUN，按用户要求不执行 |

本机曾执行 `git diff --check` 通过，但最后代码／文档收尾后仍需复核。当前没有继续运行的 VOTC 窗口；不应为验收去操作真实用户配置。

### 已发生的全量失败及处理

日志在忽略目录 `.build/`，没有删除失败证据：

1. `v9391-release-final.log`：旧 `test-v9.3.9-character-knowledge.js` 将已撤出的 checkpoint 服务接到新增生产端口，缺 `getConversationView`。测试已改为绑定真实 `ConversationDisclosureStore`，历史服务的全部反例保留；该文件单独 PASS。
2. `v9391-release-final-2.log`：`test-v9.3.8-context-usage.js` 写死 Renderer V9.3.9。已改为严格匹配当前包版本。
3. `v9391-release-final-3.log`：Provider conformance 写死 V9.3.9 版本头。已改为严格匹配当前候选，39 场景专项 PASS。
4. `v9391-release-final-4.log`：`test-v8.14.1-trait-profile-routing.js` 仍断言“有实际在场名单也不得自动见到外貌白名单”，且后续还含 V9.3.9 非预期删除原生 knownSecrets 的断言。已按用户最终规则更新为“仅白名单可见、友谊不增加秘密特质、原生准确 Owner→Target 依据有效”。**修改后尚未重跑该旧专项**，下一步优先验证。

同步更新了几个写死旧版本的测试，均仍要求与当前包版本严格相等，没有跳过版本／Provider 内容检查。Memory budget policy revision 仍为 `v9.3.9`，这是故意保持原摘要合同，不要改成 9.3.9.1。

## 5. 下一台电脑按此顺序继续

1. 先读本交接及根／子目录 AGENTS，核对当前用户约束；保留工作区全部未提交、未跟踪文件。不要重新从干净 main 开始，也不要还原这些修改。
2. 使用 **Node 22**。本机便携路径 `.build/v9331-node22/node.exe`，版本 22.23.3；系统 Node 24 不能替代完整发布门禁的 Node 22 合同。不要 npm install 或重建 `resources/app/node_modules`。
3. 复核最后 STEP 修复，重跑六个 `scripts/test-v9.3.9.1-*.js`；独立 QA 的 STEP probe 要从“观察漏洞”改成明确断言拒绝授权。原 probe exit 0 仅说明观察脚本执行，不证明漏洞已修复。
4. 按正常流程 build → verify → deploy → deployed verify。**当前 source／stage 比 resources/app 新，不能直接宣称包已经同步。** 若迁机导致部署回执失效，遵循仓库受保护部署流程核对，不手造回执、不强制覆盖未知资源。
5. 优先跑 `test-v8.14.1-trait-profile-routing.js` 和新专项，再完整跑 `test-release.js`，将后续真实失败逐项定位。不要删测试或恢复错误的全人物 Worldline 认知来迎合旧断言。完整门禁耗时较长，运行时关闭 VOTC，不并行运行窗口／重型性能测试。
6. 全量通过后，完成最终隔离 Electron UI：真实导航、姓名／头衔／称号卡片、手动隐藏与 Prompt 效果、不同听众、同场新披露自动刷新、来源切换、刷新／重启持久化、三主题与窗口尺寸。只使用临时测试用户目录及合成人物，不真实 CK3／付费 Provider。
7. 执行根 AGENTS 要求的输出文件 `node --check`、`git diff --check`、最终 deployed parity；核对未改摘要核心源码。
8. 用实际日志更新实施报告、本文的后续收口信息及 README 的状态。P1 真实案例仍缺证据时保留 NOT_CONFIRMED，不发正式 Release，不宣称 Full Freeze。除非用户另行授权，不连接 GitHub。

建议命令（将 `node` 替换成当前机器的 Node 22）：

```powershell
node scripts/runtime-dependencies.js
node scripts/test-v9.3.9.1-disclosure-extraction.js
node scripts/test-v9.3.9.1-disclosure-store.js
node scripts/test-v9.3.9.1-knowledge-ui.js
node scripts/test-v9.3.9.1-age-prompt.js
node scripts/test-v9.3.9.1-mother-knowledge.js
node scripts/test-v9.3.9.1-trait-access.js
node scripts/build-runtime.js
node scripts/verify-runtime-build.js
node scripts/deploy-runtime-build.js
node scripts/verify-runtime-build.js --deployed
node scripts/test-v8.14.1-trait-profile-routing.js
node scripts/test-v8.8-ui-style-backgrounds.js
node scripts/test-v7.10-official-action-system.js
node scripts/test-release.js
git diff --check
```

## 6. 搬运与可复用证据

推荐复制整个项目文件夹，包含隐藏 `.git`、本轮未跟踪文件、真正的 LFS 资源与 vendor 依赖。仅复制分支名称或导出 tracked diff 会丢新模块／测试。离线旧版本对照和黄金 Provider 测试依赖本地 Git 历史，保留 `.git` 后无需 GitHub。

忽略目录中建议额外保留：`.build/v9331-node22/`、`.build/runtime-deploy-state/`、`.build/v9391-*-final*.log` 和上述四份发布失败日志，以及 `.build/qa/` 下本轮 QA 夹具。构建暂存目录可以在新电脑正常重建。不要混入真实 APPDATA、CK3 存档、Provider 凭据或运行摘要。

可复用但未签最终通过的本地窗口工具：

- `.build/v9391-native-smoke.cjs`：临时 profile 启动 VOTC，合成人物，阻止 Provider fetch，使用 Node inspector／CDP；`--restart` 复用测试 profile。
- `.build/v9391-eval.cjs`、`v9391-check-ipc.js`、`v9391-native-public.js`：真实 IPC 重启隔离检查及公开介绍落盘。
- `.build/v9391-playwright-flow.js`、`v9391-run-cli.cjs`：最终 UI 流程草稿，**尚未全部跑通**。`run-cli.cjs` 的 Playwright CLI npm-cache 绝对路径是本机专属，下一台需定位自己的安装路径；不要修改项目 vendor。
- `.build/qa/v9391-disclosure-store-probe.cjs`：原 22 项独立对抗 QA。
- `.build/qa/v9391-step-parent-access.cjs`：最后 STEP 边界的观察夹具，需要补修复后断言。
- `.build/qa/knowledge-ui-inflight-scope-review.cjs`：scope 查询 pending 时，旧 Pair 仍带原标签显示、选择器禁用；新 scope 返回后清空。此瞬时展示限制未改，服务端仍拒绝过期写入；写入 IPC 永久挂起时刷新 timer 会持续单次重排，未扩展超时机制。

Playwright 技能在本机 `C:/Users/Tang/.codex/skills/playwright/SKILL.md`。截图输出为忽略目录 `output/playwright/v9.3.9.1/`，不要误提交测试 profile／日志或把初始黑图签为视觉验收。
