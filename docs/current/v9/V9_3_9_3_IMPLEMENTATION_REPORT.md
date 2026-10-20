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

## 2026-10-20 本机启动与整屏鼠标拦截修复

本次保持App9.3.9.3，处理外部维护后出现的三项本机故障：原安装目录启动失败、便携副本界面退出和透明覆盖层拦截整个屏幕。此前的远端CI结果不代表本轮修改已验收。

- 原安装目录的 `VOTC.exe`、`ffmpeg.dll` 原先继承Low完整性标签。仅恢复EXE为Medium后主进程可运行，但Renderer仍在延迟加载 `ffmpeg.dll` 时收到Win32错误5；调试断点读取的DLL名称和错误码保存在 `.build/renderer-token-failure.log`。再仅恢复该DLL为Medium后，同样的隔离冷启动完成，真实Renderer稳定存活。独立QA只读查询到Renderer的镜像加载策略为0x3，含禁止Low标签镜像的限制；未关闭该策略或沙箱。原标签证据保存在 `.build/desktop-repair-20261020/original-exe-acl.txt` 与 `original-ffmpeg-acl.txt`。壳代码段、媒体库、ICU、V8快照和resources.pak已与官方Electron35.1.5对应文件核对，未替换程序字节。
- 原目录还为程序壳和只读资源补充Users读取／执行权限，原ACL另存。范围为程序文件、resources及locales；未修改APPDATA、摘要、设置、Local State或凭据的权限与内容，也未做全盘权限重置。
- 便携副本 `C:\VOTC\locales` 为空；界面初次加载后在Blink数字输入的空语言路径发生访问异常。补齐原包同版本55项语言文件并逐文件校验后，Renderer稳定存活；该副本298项管理资源也与原目录逐字节一致。
- 外部代码在进入overlay时无条件调用 `setIgnoreMouseEvents(false)`，导致透明整窗捕获点击。恢复源码一致的主进程逻辑，由Renderer按面板实际悬停决定捕获；`backgroundThrottling:false` 从临时生成资源修补纳入源码并正常构建部署。未改摘要、认知、动作、窗口Token配置或Provider行为。
- 桌面与开始菜单快捷方式已备份，均统一指向原安装目录 `VOTC.exe`，设置显式应用ICO和正确工作目录，参数为空。便携副本的同一鼠标补丁也已修正。未删除旧副本、数据或外部留下的 `np-test.exe`。

专项扩展先复现生成主进程的整屏捕获红测，修复后通过；独立QA确认源码／生成资源一致、设置关闭后的静止悬停与空白穿透、隐藏及快速切换仍通过。原目录使用独立空白profile和合成对话完成真实Preload／IPC及打包窗口测试：优化页返回后实际点击聚焦、草稿保留、继续键入成功；指针移到透明空白后原生ignore=true；空白处模拟overlay关闭再启用，主进程没有全屏捕获，ignore仍为true。网络阻断，记录的外部请求尝试为0；测试实例已正常退出。证据位于 `.build/configinput-electron-ui-smoke/` 和忽略的Playwright快照目录。

298项构建／部署一致，payload SHA-256 `24df55d959b6e4445c8ed5483b0872fbdd6a5ecb637a40854720a3fd475ccf24`；输入专项、主题专项、官方动作一致性、入口语法检查通过。首次完整回归用系统Node24在明确要求Node22的组停止，未计为PASS；随后将仓库自带Node22测试运行器的异常Low标签恢复Medium，以该版本从头重跑，最终471／471组通过、exit0（599份测试文件、127项历史归档），日志 `.build/desktop-repair-20261020-release-node22.log`；未修改测试门禁或断言。真实CK3、付费Provider与Soak本轮未执行；未推送远端，本机环境权限修复也不属于Git提交可携带的内容。

### 桌面入口二次修正

用户复测快捷方式仍显示空白文件图标，另把EXE单独复制到了桌面。桌面EXE与原安装文件哈希相同，但旁边没有ffmpeg.dll、locales和resources，不能作为独立便携包运行。已将该重复EXE及原快捷方式保存在 `.build/desktop-shortcut-repair-20261020/`，桌面保留一个重新创建的VOTC快捷方式，目标及工作目录均为完整原安装目录；开始菜单同步。图标复制到独立稳定位置 `%LOCALAPPDATA%\VOTC-shortcuts\VOTC-desktop.ico`，重建快捷方式并通知Shell刷新。通过Windows `SHGetFileInfo`实际解析桌面链接，渲染出的图标已目视核验为VOTC标志及快捷方式箭头，证据 `shell-shortcut-icon.png`；目标与相邻运行依赖存在。未改运行源码或用户数据，本次没有重新执行全量回归。

用户随后仍见桌面空白，前一项32像素解析不能替代桌面大图标缓存验证。本次发现原ICO只有两张256像素图：一张32位彩色标志、一张1位无标志单色图；保留彩色标志，重新封装16／24／32／48／64／128／256像素的32位图标到 `%LOCALAPPDATA%\VOTC-shortcuts\VOTC-multisize.ico`，桌面和开始菜单链接使用新文件，并运行 `ie4uinit -show` 刷新图标缓存。通过 `SHGetImageList` 实际读取系统32／48／256像素图标缓存并目视确认均为VOTC标志，证据为同一备份目录内 `shell-cache-size-0.png`、`shell-cache-size-2.png`、`shell-cache-size-4.png`。原图案、程序目标和工作目录保持。

后续用户的“更改图标”窗口明确报告找不到 `%USERPROFILE%\AppData\Local\VOTC-shortcuts\VOTC-multisize.ico`。检查LNK实际字节发现WScript保存了IconEnvironmentDataBlock及HasExpIcon标志，尽管同一环境中的COM读取可展开为存在的路径。为消除此依赖，将图标保留到 `C:\VOTC\VOTC-desktop.ico`，通过官方 `IShellLinkDataList.RemoveDataBlock` 清除图标环境变量块并清除HasExpIcon，再用IPersistFile保存；没有直接改写LNK二进制格式。两处链接实际字节均验证为完整图标路径且HasExpIcon清除，图标文件存在，系统三种尺寸缓存核验通过。原先打开的属性窗口需取消关闭，避免将其旧值重新保存覆盖。
