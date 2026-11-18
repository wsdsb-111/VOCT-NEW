# 2026-11-18 V9.7.3 缓存与人物披露（已本地安装）

[OpenAI-compatible 与 OpenRouter 补丁](V9.7.md#compatible-router-followup-20261118)已本地安装（358 项一致），标准隔离启动和退出通过。原生 API 合成对照和超时专项通过；真实 CK3 长场、远端 CI 未验证。

推送前将桥接清单的 Runtime 版本统一为 9.7.3。桥接测试及重新构建后的 358 项安装校验通过；最终 payload `32ef4d8a15c0934ef4cddcf42c4c4dd4bc9d353cbedec87a247e56177cec27b6`。不改变桥接协议或 Workshop 版本。

[实施、API 对照与验收](V9.7.md#provider-cache-v973-20261118)。Core、App 和 UI 均为 9.7.3；358 项源码、构建产物与安装资源哈希一致。隔离的 VOTC.exe 通过 App、Renderer、Preload 与版本 IPC 校验、安装版姓名和特质注入测试及媒体解码，退出码 0。最终读写、渲染及发送顺序回归串行通过；未执行完整发布门禁、远端 CI、真实 CK3 跨日对话与送达、长时间运行。合成 API 样本不支持宣布 GLM 命中率提升。

# 2026-11-18 V9.7.2 GLM安全追加候选（历史安装，退出冒烟失败）

[官方条件、API原型与候选实现](V9.7.md#glm-official-append-20261118)：最新50次额度用了22次（21 COMPLETE、1超时）后停止。清晰指令组14次全部完成且金币值正确；状态不变/恢复稳定的四对暖请求，两边输入均81999，原构建命中0，生产候选81664（99.6%）。顺序固定、初始前缀共享且样本短，不作为全部场景或长期可用性保证。状态/来源变化正确回退，旧来源标记撤下。候选只置换当前已授权消息，不加旧快照/思考文本/Token，保留末尾指令及来源/Forget/预算守卫。两个专项和独立QA通过，清单669文件/541发布组/127归档；358项构建及安装哈希一致，payload 41c90326…。实际安装程序布局/来源/预算及版本IPC检查通过，但app.quit后C0000005，隔离安装冒烟整体FAILED，未签署完整发布。真实CK3、长场缓存/RP、完整发布门禁、远程CI及Soak未验收。原第一阶段结果保留如下。

# 2026-11-18 V9.7.2第一阶段排查（当时未完成修复，未发布）

[20次受控验证与剩余问题](V9.7.md#glm-cache-investigation-20261118)：实际15次原生输入354804、命中38336，10.8048%与前端一致，13次原生零命中。同一回应者前13次冻结前缀及最终参数均未变化，未发现本地静态污染、SDK重排或统计漏算。20次API额度已用完并停止：长固定首部/短变化尾部的8次暖样本约99.7%；变化前移的7次中6次零命中；实际PromptBuilder合成样本首轮0、历史/金币更新0、完全相同重发60.1%。不能用短答样本宣称实机缓存已修好，TTL/路由/缓存切片规则仍UNKNOWN。8组本地相关回归及357项安装核验通过；独立QA未找到有证据的安全本地修复。生产源码、用户设置和运行版本9.7.1保持；V9.7.2目标尚未达成，没有发布、部署或推送“已修复”版本。

# 2026-11-17 OpenRouter冻结布局核对与全服务商连接探针修复（已安装）

[实施与验证](V9.7.md#provider-probes-20261117)：OpenRouter/OpenAI-compatible/Player2原探针只有1 Token，Gemini为5，基础探针为10；均已修复。OpenRouter/DeepSeek为128且仅探针关闭推理；其余生成探针2048，GLM仅探针克隆配置使用low，正式聊天设置不变，截断/未知结束/空回复仍失败。真实OpenRouter连接与流式聊天、OpenAI-compatible/DeepSeek/GLM探针通过；已配置Gemini返回provider_unknown，同Google端点无密钥请求也出现连接超时，真实生成未验收。未填写密钥及本地占位项未发生成请求。OpenRouter与DeepSeek现有V813上层冻结/下层动态布局经两轮真实PromptBuilder消息字节对照一致，无新排序或权限变更。12组相关检查通过，清单667文件/539发布组/127归档；安装357项一致，隔离OpenRouter按钮/参数/IPC/媒体/退出code0通过。没有运行完整发布、远程CI、真实CK3或Soak，不把短样本写成缓存命中率或所有Provider可用性验收。

# 2026-11-16 DeepSeek测试连接误报（已安装）

[连接探针修复与正式对话验证](V9.7.md#deepseek-connection-probe-20261116)：原探针只给1个输出Token，却要求完整STOP，存在误报。现为128 Token、短答OK，仅探针禁用thinking，严格STOP且非空才成功。5组相关检查与清单通过，真实LLMManager的连接探针及流式对话各一次成功。已部署1模块、357项哈希一致。隔离界面两次均完成连接成功反馈及参数校验，但app.quit后均C0000005，安装冒烟整体FAILED，记录保留；不以API成功替代退出稳定性验收。

# 2026-11-16 战役剧本背景上限5000（已安装）

[5000字符上限与安装验证](V9.7.md#background-limit-5000-20261116)：后端、编辑器计数/保存校验与中英文错误提示已同步。5000个Unicode code points可完整保存并注入，5001拒绝；三个背景专项通过。用户退出VOTC后部署4项资源，357项哈希一致；两次隔离启动/重启显示“0 / 5000”，正常退出。战役隔离、旧数据与新对话冻结语义保持；未新增API请求。

# 2026-11-16 特质与记忆遵循增强（已配置，模型仍有细节补造）

[遵循核对与6次API结果](V9.7.md#trait-memory-adherence-20261116)：实际PromptBuilder合成构建确认本人三条完整特质desc与完整获准摘要进入消息。主提示词仅新增326字符的描述优先/事实粒度规则，现7281字符；原C节奏、题材预留及8192/high保持，最终两次隔离启动/重启与真实IPC读回通过。本轮初次1次加追加5次API均STOP；数字与主要选择正确、两种性格有区别，但GLM/DeepSeek仍补造未载旧事，单样本未证明改动显著更好。保留全部原文，不宣称严格遵循或长场验收通过。

# 2026-11-16 C定稿与GLM输出空间（已配置）

[C定稿安装记录](V9.7.md#rp-C-installed-20261116)：用户选择C后，明确按实际剧情决定推进/停留/收束；6955字符主提示词已写入本机，保留黑暗题材呈现约定并留纯文本题材自填区。GLM max_tokens=8192、high保持；只改这两个配置字段。最终隔离启动/重启两次通过，真实IPC读回文本、占位和8192/high；首次退出C0000005及中间版本重试证据保留。没有新增付费请求，长场RP与截断改善待实测。

# 2026-11-16 RP提示词候选试读（未安装）

[主提示词沉浸与主动推进实验](V9.7.md#rp-prompt-comparison-20261116)：按用户授权完成16次串行真实GLM/DeepSeek调用，四版（含共同规范化对照）×两家×连续两轮，全部STOP。仅生成本地候选和原始试读报告，未修改生产源码、现用提示词或模型设置。GLM近两天13次LENGTH显示4096输出预算几乎被推理耗尽，不能全称网络超时。短合成场景对照也良好，尚未验证长场景消除追问或实机提速；候选待玩家选择。

# 2026-11-12 本机热修复

[最近三人对话耗时与流式刷新修复](V9.7.md#three-person-stream-latency-20261112)：第一轮两位NPC的Provider请求103.516/98.611秒，首段可见台词前85.764/87.304秒；本地准备约1–5秒，最终Prompt构建24–31毫秒。修复隐藏推理片段重复广播全历史，以及界面漏传streamStatus；模型high参数及业务效果保持。六组相关业务回归、清单/文档检查、356项安装核验与两次合成IPC安装冒烟通过。真实提速待复测，六次零缓存的Provider原因UNKNOWN。

[保留效果的多人优化已安装](V9.7.md#preserved-dialogue-performance-20261112)：单次四人认知上下文的文件读取6→1，发送前仍重新读取复核；新增前处理与动作分段计时。模型参数、Prompt正文及动作顺序保持。5项受管模块替换，356项部署核验、10组相关回归与诊断关闭/开启两次安装冒烟通过；真实整轮提速幅度待实测。

[续聊身份误判与四人耗时排查](V9.7.md#worldline-dialogue-guard-20261112)：修复日志增长使身份标记移出1MiB尾窗的误判，已安装；356项部署核验、八项相关回归与隔离启动/重启通过。指定历史场的原始错误已滚动覆盖，不能确认唯一历史触发点。多人推理及逐人动作依赖的耗时与有行为取舍的提速方案见报告；本次未改模型、Prompt正文、角色认知和动作时序，未推送远端。

# V9.7.1 当前候选（2026-11-02）

自主背景设定已接入并安装到本机V9.7.1。三专项与相关14项本机回归通过；355项source/artifact/deployed哈希一致，payload `26d5c786c1a7bbeb3e2cbeebfb7fffca261670266bab8498f083362bfa1dc72e`。安装阶段按用户要求未推送远端或运行远程CI。2026-11-03用户另行授权推送main；本次同步源码、测试和文档，由现有push工作流进行隔离验证。528组完整发布门禁本机未运行，远端结果须按本次准确SHA单列，不以旧CI替代。

本机安装替换15项受管文件，备份位于 `.build/runtime-deploy-state/backups/7f279628-d809-4f28-85d9-e6ac31746acf`。两次独立测试配置启动/重启均PASS：App/IPC 9.7.1，世界书新面板、标题与两条API在位，未绑定战役时输入框为空且禁用，ffmpeg和PCM解码正常，zh-CN资源存在，退出code0。证据位于忽略目录 `.build/v971-installed-smoke.json`，没有分发复制或真实用户设置/记忆迁移。真实CK3当前战役导出及模型表现由用户实测；本轮UI启动验证不冒充实机模型验收。

以下保留V9.7已完成验收。

# V9.7 当前交付状态（2026-11-01）

本页汇总当前状态；[V9.7 版本册](V9.7.md) 各章是固定来源快照，章内的历史 PENDING/FAILED 不会因后来成功而被改写。

## 已实施与本机验证

- Core/App/UI 9.7.0；353 映射隔离构建通过，payload `f6b679ed8aa59fcd9c74cc2ebc3889623e1ed0c365de01810ca5345989d623eb`。本机已按用户确认部署 V9.7.0，7项受管文件替换，353项部署哈希全部匹配。
- 不可达 Provider 分支已退役；旧 options 的 null/getter/coercion 行为保留。原有完整模块、IPC/配置/数据格式、五代亲属、Legacy/Forget/Pair、Canon 4096、Action/Letter/Bridge 不删除。
- 原 17 项专项、CI baseline guard 与文档保留专项均已本机串行通过，Node 堆上限 384MB；manifest 当前为 653 test 文件、525 release groups、127 archived checks。原 519 发布组未降级。
- 文档 327 份正文合并为 V6–V9 的 35 册，另有 13 个连续阶段直达索引。327 原文 Git 集合、正文完整性、旧已识别锚点、相对链接目标及 988 个册间锚点核对通过。未知 fragment 不丢弃；本次观测源文链接未发现未知目标章节片段。跨 minor 全文仍在 OVERVIEW，各 minor 有准确章节入口。
- Terra/high 最终只读复核未发现明确 P0/P1；其审查不等同于执行测试。环境变量只用于防误用，不是无法伪造的隔离安全边界。

## 准确代码 SHA 验收与 CI 历史

1. `b745936` / [41283699861](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/41283699861) FAILED：新构建通过，无初始部署回执且旧目标不同，保护拒绝；release/EXE 未执行。
2. `9449b0a` / [41285162334](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/41285162334) FAILED：冻结旧资源的 `AGENTS.md` 因 Git CRLF/LF 差异被严格哈希拒绝；release/EXE 未执行。
3. `dc83f65` / [41286183575](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/41286183575) 与文档提交 `ce73a74` / [41286289986](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/41286289986) FAILED：旧源码含 CRLF、旧资源 Git blob 为 LF，单边归一化仍无法证明。未绕过正文保护。
4. `8703e40` / [41286919315](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/41286919315) FAILED：已完成基线采用、353映射隔离升级及完整 EXE 检查；发布回归发现 Bridge 诊断界面仍显示9.6.1，补齐单行版本常量后专项通过。
5. **`f26394a53160a39618d3ebba7b84e062b379c683` / [41287454791](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/41287454791) SUCCESS**：525组完整发布、353项 source/artifact/deployed parity、97文件独立Mod产物验证、完整 EXE 冷启动/重启/IPC、PCM媒体解码32样本/8kHz/单声道、en-US locale pak和正常退出 code0全部通过。新payload如上，与本机构建一致；这条 CI 记录本身不作为本机部署证明；本机验证见下文。

CI基线采用只在隔离checkout显式执行：先从3721固定Git源码取回353份原始blob并逐个匹配冻结原始SHA，再比较双方严格UTF-8的换行归一化指纹。receipt记录目标实际字节；完整清单、未知正文和已有receipt仍拒绝。本机沙盒用353份真实旧Git资源复核采用和目标哈希通过，无完整分发复制。

七个源码映射发生变化：六项仅版本标签，一项Provider不可达分支；其余346项保持基线原字节。Terra/high已逐项审查这七项diff，没有以按文件白名单代替实际审查。原V9.7冻结章节中的初期6项/a8d9305b…为对应阶段证据，当前以本页为准。

**工程候选与本机安装完成；外部 Gate 独立。** 当前 main 后续仅更新验收文档时，以上通过归属于准确功能代码提交，后续文档CI按其自身SHA核对，不把历史成功改记为其它SHA。

完整 release 与 EXE 冷启动/重启/媒体仅在隔离 Windows CI 执行。尚无新版本的真实 CK3、真实 Provider、本机输入、2h/100+ 回合 Soak；维持 `CK3_LIVE_PENDING / PROVIDER_LIVE_PENDING`，Soak 交 V9.8，不宣称 Full Freeze。

当前路线：旧 V9.7 Workshop 一体化分发取消，新 V9.8 为 RC/Soak。Runtime/Workshop 独立维护，本轮没有 Steam 上传、付费请求或真实数据迁移。

## 本机授权部署与验证（2026-11-01）

用户明确指令“直接部署吧”后，执行既有事务部署，无真实userdata迁移或清理。

- `node scripts/deploy-runtime-build.js`：替换7项文件；`verify-runtime-build.js --deployed`：353项 source/artifact/deployed hash 全部一致。payload与上方准确代码CI一致。
- 旧文件备份：`.build/runtime-deploy-state/backups/2775fe12-7102-4711-a77a-cf67eb0aef9a`；既有COMPLETED receipt记录全部目标哈希。
- 直接从安装目录启动复用的VOTC.exe，使用`.build`中的全新隔离profile，两次串行启动/重启均PASS：App/IPC 9.7.0，Renderer complete（正文843/857字符），ffmpeg LOADED，PCM 32样本/8000Hz/单声道，zh-CN locale pak在位，app.quit退出code0。未创建完整分发副本。
- 首次自动化核验因CDP `Promise was collected`失败，保留匿名失败证据；未修改程序，换新隔离profile重试后上述两次通过。结果分别在忽略目录`.build/v97-installed-smoke-first-failure.json`与`.build/v97-installed-smoke.json`。这不替代真实CK3/Provider或Soak。
- 当前安装资源由本机事务生成，7个`resources/app`受管文件在本机与Git检出有预期差异；它们不混入本次文档提交。GitHub CI继续从src构建并在隔离checkout生成资源，不把本机安装反向当源码。
