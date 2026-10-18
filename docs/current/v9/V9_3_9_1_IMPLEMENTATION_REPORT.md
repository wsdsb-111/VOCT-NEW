# V9.3.9.1 修复实施与验证报告

日期：2026-10-18。基线：本地 V9.3.9 `a8b1f31d1b536dfeda312a8d474ec5dde61a287a`；工作分支 `codex/v9.3.9.1-disclosure-fix`。Core／App／UI 为 9.3.9.1，复用既有 Electron 壳。本文记录修复结果，不代表正式发布或实机验收。

**停止状态：用户因额度要求转移到下一台电脑继续。最终源码构建已完成，但最后 STEP 认知边界修复尚未部署；完整发布门禁未通过。后续以 [跨电脑交接记录](V9_3_9_1_HANDOFF.md) 的准确进度和剩余任务为起点。修改尚未提交或推送。**

施工依据为用户提供的《VOCT V9.3.9.1 修复施工文档》，并以用户后续纠正为准：不连接 GitHub 查旧 UI；只管理当前对话玩家／NPC 之间的认知；保留原有底层判定，撤回非预期 Worldline 重构。公开发言让所有实际在场听众各自获知，私语只传给指定人物；外貌／身体沿用已有白名单，当前公开可靠的父母子女、亲兄弟姐妹（含公开半亲）可免披露互知特质，未暴露真实私生亲属关系不适用；称号为公开描述信息。

## P0：人物认知与披露

### 差异依据及最小恢复范围

本地 `37df16e` 的 `trait-profile-selector.js` 原本按当前日志的 `observer.knownSecrets.ownerId === target.id` 取得对应特质，并保留 Owner／Target／Campaign／日期限制及手动隐藏优先。V9.3.9 将这条原生定向依据替换为 Worldline checkpoint 服务，新增同领地公开头衔自动授权；`conversation.js` 还把 `gameData.characters.keys()` 全部传给该服务。这些变动已撤出生产接线，原 `worldline/character-knowledge-service.js` 保留作历史实现，旧 `records-v1.json` 不迁移、不删除，也不作为原始对话披露证明。

旧对话事实抽取可在本地 `f9c088f` 的原始 Memory4 disclosure 模块及当前隔离归档中核对；只复用其中确定性的候选、明确断言和听众授权规则，未恢复 Memory4 协调器、Sidecar、Durable、Year／Life、模型提取或后台重建。姓名及独立称号是用户本轮明确要求补齐的记录类型，不将它们冒充旧 Memory4 的既有字段。

`conversation/character-disclosure-extraction.js` 为纯本地提取；`character-disclosure-store.js` 只保存对话披露和手动特质状态。生产 Main 使用后者，不访问 Worldline checkpoint。当前对话参与者和明确提及目标均按 ID 直接读取，不为全体人物构建认知。原有 `createTraitProfileView` 对 Runtime GameData 的展示副本构造保持原结构；它原有的复制遍历不属于新增 Worldline 扫描。

### 可见行为与证据

- “摘要”的个人摘要管理区域始终挂载“人物认知 · 当前对话”，无历史摘要也能进入；无活动对话显示说明。独立选择“谁知道／关于谁”，默认不自动选人，人物主标签使用真实姓名，同名不同 ID 分开关联。
- `NAME`、`TITLE`、`NICKNAME` 分别记录姓名、头衔、称号；称号沿用公开可见规则。其他人的姓名标签仍按既有展示行为提供，本轮没有另造姓名脱敏系统。外貌／身体自动访问复用现有 `trait-visibility-policy.js`，不扩展白名单。
- 公开披露按原始消息的实际在场窗口为每位听众写一条定向事实；候场、迟加入、暂离不追溯获知。私语按唯一明确接收人取交集，疑问、否定、未来、旁白、传闻、错误说话者和同名歧义不当作明确披露。第三人转述须有说话者自己的合法知情依据。
- 手动操作仅限可管理特质，按单独 Owner→Target 持久化。普通人工隐藏压过对话及原生 knownSecrets；白名单可见特质和当前公开直亲属于直接可知，不以人工隐藏伪造未知，也不显示无效切换按钮。亲属授权只沿当前严格公开父母证据，不因配偶／妾室、继亲、原始 siblings 标签或隐藏 real_father／real_mother 指针授权。
- 持久化路径为本地 `VOTC_DATA_DIR/character-knowledge/disclosures-v1.json`，按 Campaign／Owner／Target／fact 隔离。消息修订、事实指纹、听众、获知日期及转述知情依据复核；编辑／删除源头会使相关转述失效，循环转述不能自证。手动写入绑定当前对话／来源令牌和 expectedRevision，失败提示刷新，不静默覆盖。
- Conversation 只在玩家实际发言、完整成功 NPC 回复和编辑／重新生成来源变动时记录；取消、失败和流式半成品不写自动事实。上下文仍在发送前复核，手动状态真实参与对应回应者的 Prompt 投影。

新增 IPC 仅 `characterKnowledge:getConversationView`；原 Owner／Target／manual IPC 保留名称并加入 conversationId 复验，Preload 只暴露既有受限桥。新文件列入显式 Runtime 映射。

## P1：年龄 +1

用户仅确认 NPC 生成内容曾比实际年龄大 1，没有同日期面板截图、原始导出和最终 Prompt，因此原实机案例状态为 **NOT_CONFIRMED**。

可合成复现的另一条冲突已修复：稳定 responder profile 缓存过年龄 18 后，同一缓存下最新权威年龄改为 17，旧实现会同时呈现稳定年龄 18 和动态年龄 17。仅移除 `formatStableProfile` 的年龄行；年龄解析、稳定缓存结构、动态当前事实、历史摘要原文不变，不统一减一，也不把日历估算升级为权威值。稳定 Prompt 的正文兼容变化由 9.3.9.1 版本标注，block ID／anchor 不变。

生日未到、生日当天、可信年龄、未知来源、缺失年龄及历史年龄文本的合成检查通过；既有年龄／跨年边界回归继续验证。不能将这个冲突修复写成昨晚真实 +1 根因已经证实；施工文档的 P1 完整门槛尚未签署，因此不宣布正式发布或 Full Freeze。

## P2：妻子／妾室子女的母亲身份

新增最小玩家、妻子、妾室、两名子女场景，使用当前 `CK3_DIRECT_PARENT` 和 `CK3_OTHER_PARENT` 证据。现有关系图和家庭事实块已能在母亲之间没有关系记录时，按明确兄弟称谓回答对应母亲；不存在需要安全修改的亲属实现，故保留 V9.3.9 来源、缓存和标签代码。UNKNOWN／SECRET、旧 Campaign／snapshot、缺失证据均保持未知；公开亲属不会把该家族信息广播给陌生人。

额外限制：直接询问“我的母亲是谁？”的现有家庭查询解析可能返回 `ANCHOR_UNKNOWN`，没有生成错误人名。本轮按范围登记，不借认知修复扩展整套指代解析。真实 CK3 中若未加载公开 kids 导出证据，保守未知仍是预期边界。

## 验证记录

本地验证使用便携 Node 22.23.3，夹具及窗口使用 `.build` 临时目录，不读写真实 APPDATA、CK3 存档、日志、摘要或凭据。

| 项目 | 结果 |
| --- | --- |
| Runtime 依赖 | PASS：5,981 文件／264 包，vendor 未更新 |
| 六项新专项 | 均曾 PASS；最后 STEP 修复后 trait-access 再次 PASS，六项尚未统一重跑 |
| 独立对抗 QA | 22／22 PASS 后额外发现 STEP 边界；已补源码与正式反例，最后独立 STEP 复核待运行 |
| 构建／部署／已部署 parity | 最终 stage 构建 PASS：298 项、payload `f1bb6cf5fa73762695b21995eb5338647583ee32f25c53175076aabc4f1bb06e`，未 verify／deploy。最近部署并通过 parity 的为前一 payload `dd648d2f4735c94bb0b05d272da6a236e8b7c73dca3ddcfe0b8faba72353814a` |
| 完整 Release Regression | FAILED／未完成：最近停在第 190 组 trait-profile-routing；旧白名单／knownSecrets 断言已按用户合同修订，尚未重跑。库存 458 release groups、127 historical entries，不代表通过数 |
| 隔离打包窗口 | PARTIAL：真实保存／重启／Pair 隔离／公开介绍落盘已验；最终 UI 全流程及三主题截图待完成 |
| 语法／差异检查 | 构建语法检查及中途 diff-check 通过；最终输出语法与部署 parity 待后续收口 |
| GitHub 上传／当前远端 CI | NOT_RUN，按用户要求暂缓，不连接远端 |
| 真实 CK3／付费 Provider／Soak／GitHub Release | NOT_RUN |

新专项均登记 `scripts/test-manifest.js`。旧 `test-v9.3.9-independent-qa.js` 保留 checkpoint 来源失效反例；只将三条依赖非预期 Worldline 重构的断言改为“checkpoint 事实仍阻断，但当前日志的独立 Owner→Target 证据有效”，与恢复后的生产行为一致，没有删除测试来隐藏失败。

实际窗口发现并修正 NICKNAME 卡片过滤遗漏；源码审阅补齐同场消息更新后刷新所选 Pair 的事实。最终视觉复核尚未结束，初始黑图来自测试窗口失焦时既有 overlay 隐藏行为，不作为视觉通过证据。候选版本一致性检查已改为严格匹配包版本，Provider 39 个黄金场景专项 PASS；旧 trait-profile-routing 对最终白名单和原生 knownSecrets 合同的修订仍需重跑。各轮失败日志及明确下一步见交接记录。

## 不变项与交接

`memory-system/`、`summaries/`、`prompts/prompt-builder.js`、`worldline/`、`game-data/` 源码与 V9.3.9 基线不变。固定 Recent2、合法官方追忆、玩家事项簿，双／三人 time5、4+ 人 time3、全场 third3，65%／70%／75% 与 80k／84k／96k，按回应者冻结及发送前来源复核全部保留。Conversation 仅增加定向披露记录钩子及收窄认知目标，未改召回／预算／冻结方法。构建按既有字节映射同步资源；部分基线生成文件只有换行字节差异，不是业务修改。

V9.3.7 `9caffe6` 的远端失败继续归属于该历史 SHA；本轮本地通过不覆盖它。V9.3.9 报告保留当时快照，由本报告替代其“当前人物认知”描述。所有真实游戏、Provider、缓存收益和原 +1 案例均需各自证据后才能签署。
