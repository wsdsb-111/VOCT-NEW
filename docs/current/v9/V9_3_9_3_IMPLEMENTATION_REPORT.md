# V9.3.9.3 修复实施与验证报告

## 范围与基线

本轮依据用户提供的 `VOCT_V9.3.9.3_修复施工方案.md`，基线为 main `83a2f1958a5563aa2799869b9cdb8524fa5a8893`。修复普通 NPC 回复重新生成、场外子女年龄证据缺口、长幼事实知情边界及发布回归夹具；保留用户已实测正常的摘要删除。用户选择：已有动作的回复仅重写台词，保留动作结果，不重复执行。玩家自行配置的上下文窗口、摘要配额、稳定 Prompt block ID、Durable 退役及 Legacy 权限合同不变。

## 实现与根因

### 回复重新生成

旧校验把 `hasActionOutcome` 与跨场／跨玩家轮次混为一类；真实回复经常带好感度等动作反馈，因而正常蓝色按钮也被拒绝。新增当前回复的纯台词重写路径，复用发送前来源／Forget 校验；只在完整生成且当前场景、玩家轮次和原回复仍有效时替换正文。保留原 message ID、动作反馈、ACK、审批状态和队列，不调用 ActionEngine、不安排第二次回读。失败、取消或来源撤回保留原正文，错误卡重试仍走纯台词路径。正在处理动作或审批时明确阻止并提示。无动作回复沿用原有生成与队列流程。

首次打包实点又发现 Renderer 的 `StreamingMarkdown` 只按旧正文长度追加，后台已改为新台词但页面仍显示旧台词。同 ID 的替换现在清理旧DOM和解析器后按完整新正文渲染；正常流式增长不重置。独立反例补充了旧解析器结束后先切换动画、再收到追加文本的顺序，确保新解析器收到完整文本。冻结资源再次实点后，DOM与后台都为“隔离回复-2”，两次台词请求、一次动作评估、零新增确认，动作反馈逐字节不变、无错误；不是仅凭后台 success 判定通过。

### 场外子女年龄

实际导出的 `kids` 行已有原始 `GetAge`，却缺少 App 解析器要求的 `PUBLIC_LEGAL_PARENT` 字段；场外孩子未进入 canonical 人物表时，关系图无法确认合法父母边，年龄事实不能进入针对性 FamilyFact。活动 Workshop `3346777360` 的 `common/scripted_effects/log_character_v2_effect.txt` 已补齐状态：在孩子的 `any_parent` 中确认当前 Owner 确为其 mother／father才发公开标记，否则 `UNKNOWN`。原始年龄与生日字节字段不改，不统一减一，不放宽 App 来源校验。仓库现有补丁 `patches/V9_3_9_KIDS_DIRECT_PARENT_EVIDENCE.patch` 已包含同源修复。

改前文件按字节备份至仓库忽略的 `.build/v9393-age-exporter.pre-fix.bin`，SHA-256 `9721a1533f11846e9c84d018cd58bf1be6ae8ecacdca3ef950a2c826e5070f29`。合成完整链路证明：CK3 raw9、日历诊断10时，最终 FamilyFact 为9；日期推算不替代 CK3。无标记、缺失、冲突、过期或非法年龄不猜数值。

用户补充的母子案例在当前日志中已为另一个游戏日期、孩子 raw11；它不是历史“实际9／回答10”的同日期样本。历史数值偏差仍为 NOT_REPRODUCED；已确认并修正的是缺少关系证明导致年龄事实缺席。必须重载模组并生成新日志后，再做同日期面板、原始导出与最终 Prompt 对照。

### 长幼与知情边界

旧逻辑对同场所有人物计算长幼，未要求有效亲属关系及回应者知情依据。现在双向关系必须一致、每段路径具有当前公开来源，且回应者有权知道这组关系才可输出长幼；缺失／冲突／错误 Campaign、快照或 Owner 不输出。规范配偶记录使用独立来源校验，不能借用或扩大近亲特质白名单；伯叔称谓根据本人可知的公开父亲路径判断，并继续与父亲比较长幼。独立 QA 首先复现了错误阻断配偶称谓及伯叔退化两项回归，修正后两项均通过；错误战役、过期、秘密配偶反例及私人人格遮盖也通过。继亲沿既有独立 StepFamilyFact 查询分支处理。不通过亲属事实扩大特质、姓名或 Memory 权限。

### Legacy 回归与调试输出

`v9.3.4-independent-qa` 正向夹具的 conversationId 与对应 Episode 不一致，生产 `LEGACY_SUMMARY_MEMORY_MAPPING_INCOMPLETE` 拒绝正确。仅修夹具显式绑定及预检查，不改生产映射。原 HEAD 夹具实跑 4 PASS／1 FAIL，修正后 5 PASS／0 FAIL；错误 conversationId／Campaign、重复 Episode 和事务回滚边界继续由既有专项覆盖。

首次完整清单还在 `v8.14-player-identity-knowledge` 因旧断言失败：该断言要求公开父子仍不可互知精确头衔，与V9.3.9.2已采用的公开近亲白名单冲突。测试现在单独验证合法近亲的姓名／头衔例外及秘密／记忆仍不授权；原陌生人断言保留，并增加错误Campaign不得获得父亲头衔的反例。专项13组通过；失败点之后的全部清单诊断通过，再从头执行最终完整门禁。生产代码未为这些旧断言放宽。

16份 `.playwright-cli/page-*.yml` 已停止 Git 追踪，本地文件保留，目录加入忽略；无源码／夹具引用这些快照。Core／App／UI 版本统一为9.3.9.3；Workshop2.0.5、协议3.0和存储2.5不变。

## 验证状态

- 专项：实际 Conversation.respondAs 动作结果重写红绿对照通过；覆盖流式／非流式、失败后重试、Forget撤回、玩家轮次替换、ACK不重放和反馈逐字节保留。
- 年龄：真实 parser→GameData→FamilyFact→PromptBuilder 合成链路、仓库补丁与活动 exporter 静态契约、既有年龄权威／校准／Parser／Prompt 专项通过。
- 长幼：公开关系来源、无关同场人物、回应者知情、同名不同 ID 及双向手足／堂表亲专项通过。
- 独立QA：10组通过，包含并发、审批、取消、部分流、后续NPC、跨场、来源撤回、配偶来源反例及特质权限隔离。
- 构建与部署：298项映射源码／构建／部署一致，App9.3.9.3；最终payload SHA-256 `c7a31f6174af62c486b57ced36ea524ec7ea53f25602090bb30b80ad8fd00c5d`。
- 隔离打包窗口：冻结资源真实Preload／IPC／Main／Renderer按钮点击与DOM断言通过；模拟Provider及动作，网络阻断，使用全新profile。截图在忽略目录 `output/playwright/v9.3.9.3/narration-regenerated.png`，DOM与状态证据在 `.build/v9393-ui-dom-final.log` 和 `.build/v9393-ui-narration-status-final.json`。实例已正常退出。
- 完整发布门禁：最终冻结源码由Node22从头执行 `scripts/test-release.js`，470／470组通过、exit0，证据 `.build/v9393-release-frozen.log`；598份测试文件分类、127项历史归档。前端补充修复前的469组通过仅为历史批次，不替代此最终结果。七项部署入口语法检查、Renderer专项语法及 `git diff --check` 通过。
- 真实 CK3 新导出／面板对照、原9→10场景、真实 Provider、Soak：NOT_RUN。本轮不消耗付费额度。
- 远端 CI：代码`291040b34deadd24b7c8e3c3a5285145cdebebbf`已推送main，[CI 39242368694](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39242368694)原生Windows Runner的471组完整回归通过；结果归属于该SHA，不引用旧版PASS。基线和历史SHA的失败记录保留。

## 用户复测

关闭并重新启动 CK3，使修改后的 Workshop 脚本被加载；重新进入对话生成新导出。询问场外子女年龄，并对照同一游戏日期的 CK3 面板。对有好感度结果的当前回复点击蓝色重新生成，确认只换台词，动作反馈和实际好感度不再次变化。

## 复验命令

```powershell
node scripts/test-v9.3.9.3-narration-regenerate.js
node scripts/test-v9.3.9.3-independent-qa.js
node scripts/test-v9.3.9.3-markdown-replacement.js
node scripts/test-v9.3.9.3-age-family-prompt.js
node scripts/test-v9.3.9.3-age-exporter.js
node scripts/verify-runtime-build.js --deployed
node scripts/test-release.js
git diff --check
```

本轮完整门禁采用仓库已有Node22，与工作流版本一致。需真实原子文件操作的测试在正常授权后执行；沙箱EPERM或审批超时不作为业务失败，也不通过替换文件系统绕过。

## 2026-10-19 设置返回聊天输入补丁

用户报告从对话设置的优化页或摘要编辑返回后，输入框点击无光标且并未生成中。旧App关闭X及快捷设置关闭路径会无条件调用 `setIgnoreMouseEvents(true)`；鼠标停在已露出的聊天区时没有新的 `mouseenter`，整窗仍穿透，点击无法聚焦输入框。Chat与Config的离开事件各自直接开启穿透，也没有按切换后的实际面板位置复核。

最小修复仅改Renderer：增加共享 `syncOverlayMouseCapture()`，按当前聊天框、最小化按钮和设置面板的实际 `:hover` 决定捕获；面板状态改变及鼠标离开后在下一帧读当前DOM，取消过期状态帧。关闭设置不再无条件穿透。鼠标在空白处、窗口隐藏或没有可见面板时仍穿透；不自动抢键盘焦点，不改变对话、摘要或动作业务。

专项 `test-v9.3.9.3-config-input.js` 使用实际App函数复现原关闭逻辑，红测为ignore=true而预期false；修后关闭X、快捷关闭、齿轮切换、静止指针、空白穿透、隐藏和快速开关通过。独立QA只读复核了主进程／Preload／Renderer焦点链路。

隔离打包窗口使用合成对话及Legacy摘要，已验证：

- 齿轮→优化→关闭，鼠标停在露出的聊天框，原生穿透状态为false；点击输入框后获得焦点、实际键入成功，disabled=false。
- 齿轮→摘要→打开编辑→保存合成摘要→关闭设置，输入框实际聚焦并继续键入；之前的草稿完整保留。
- 鼠标移出面板到空白处，原生穿透状态恢复true；测试实例正常退出，没有发送对话、模型请求或游戏动作。

本补丁仍为App9.3.9.3，298项源码／构建／部署一致，当前payload SHA-256 `ca04e8fa4b174788dff987308237e996f56a48ea834caa7e204282b6feb43566`。新增专项已登记，清单共471组、599份测试文件、127项历史归档；前述470组结果只属于此前冻结资源，不能替代本补丁结果。专项红测和外部空白穿透证据分别在 `.build/config-input-red.log`、`.build/config-input-outside-status.json`；隔离窗口快照留在忽略目录，不进入Git。

本补丁本地完整门禁未签署PASS：最初两次执行因临时目录EPERM中断，原失败集成组独立重试通过；原生探针确认系统TEMP不可写、工作区.build可写。随后仅对测试进程把TEMP/TMP指向.build，保留原脚本与原生文件系统，但 `v9.3.6.2-candidate-directory-qa` 的junction反例失败；单独重试仍失败，独立空目录探针发现创建后 `readlinkSync` 返回EINVAL，当前执行环境无法提供该反例需要的链接语义。未改链接安全断言、Memory生产代码或系统权限。记录在 `.build/config-input-release.log`、`.build/config-input-release-final.log`、`.build/config-input-release-workspace-temp.log`、`.build/config-input-candidate-retry.log`。不把这些中断算作全量通过；远端原生Runner结果须按本补丁提交SHA核验。输入专项、独立源码QA、打包窗口实际焦点／键入／草稿保留／空白穿透与构建部署检查已通过。

远端验收已完成：main代码`291040b34deadd24b7c8e3c3a5285145cdebebbf`，Run `39242368694`、Job `118026000845`（原生windows-latest／Node22），结论SUCCESS。日志明确输出 `VOTC Release Regression: PASS (471 groups)`，清单599份测试、127历史归档，构建／部署298项通过，payload为`ca04e8fa4b174788dff987308237e996f56a48ea834caa7e204282b6feb43566`，与本机一致。链接来源安全断言未放宽；该结果验证了当前源码，不代表真实CK3／Provider／Soak验收完成。
