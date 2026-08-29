# Voices of the Court（VOTC）

Voices of the Court 是一个面向《Crusader Kings III》（CK3）的沉浸式 AI 宫廷对话工具。它读取 CK3 的游戏日志和角色数据，将当前日期、朝代、角色关系、场景、记忆与历史背景整理为提示词，再通过兼容 OpenAI Chat Completions 格式的 API 生成角色扮演回复。

本仓库保存的是 VOTC 的 Windows 打包版本及默认用户数据，适合直接运行、测试和二次配置。

## 主要功能

- **CK3 角色扮演对话**：根据角色的性格、头衔、关系、财富、信仰、处境和当前场景生成回复。
- **动态历史背景**：从游戏日期提取年份，自动判断唐、五代十国、北宋、南宋和元朝等时期，并提供对应的事件和人物背景。
- **历史认知边界**：提示词要求角色只使用当前年份已经发生、写成、流传或成名的信息，避免引用未来人物、事件、诗词和典故。
- **当前政局优先**：皇帝和年号从实际游戏角色数据中识别，支持玩家篡位或改变历史后的沙盒玩法。
- **Memory Engine 2.5**：保留 `角色ID_姓名/与对方的对话.json` 人物目录与 2.4 写入合同，并新增整场冻结的 Session Topic Anchor，以及只在明确回忆意图下触发、Top1、默认 256 Token 的 Turn Recall。
- **Action Engine 4.0**：仅保留性能与精准模式；精准模式对每条有效 RP 对白调用一次官方式 Q2 Selector，性能模式采用确定性本地 HIT 与最多一次 Compact Selector，两者在 Proposal 后共用 Consent、校验、批处理、审批和执行管线。
- **候场与在场窗口**：多人会话可在首句前设置候场，开始后可请入内、永久离场，或选择昏迷、睡着、暂时离开三种可返回的暂离模式；每名角色只回应、获知并保存自己实际在场区间的内容。
- **多人对话摘要**：支持玩家与当前会话中的全部 NPC 同时对话，并将多人互动摘要按实际参与者逐对保存，避免 NPC 之间的对话内容丢失。
- **动态人物关系**：提及未参与当前对话的角色时，也可以从 CK3 角色和亲属数据中加载关系；兄弟姐妹会结合出生日期或年龄判断哥哥、弟弟、姐姐和妹妹。
- **信件系统**：读取 CK3 信件数据，生成符合收信人身份的回信，并保存信件摘要。
- **行动系统**：根据对话内容识别可执行的游戏行动，并通过结构化 JSON 请求保证参数格式。
- **多语言资源**：项目包含中文、英语、日语、韩语、俄语、德语、法语、西班牙语和波兰语等本地化资源。

## 运行环境

- Windows 10/11
- 《Crusader Kings III》
- CK3 1.18.*（模组版本要求）
- 一个兼容 OpenAI Chat Completions 格式的模型 API

## 快速开始

1. 优先下载完整发布包。若从源码仓库克隆，请先安装 Git LFS，并在克隆后执行：

   ```powershell
   git lfs install
   git lfs pull
   node scripts\test-release-assets.js
   ```

   完整性检查通过后再继续；如果 `VOTC.exe`、`*.dll` 或 `*.pak` 仍是文本指针，程序无法启动。
2. 运行 `VOTC.exe`。
3. 在应用设置中配置 CK3 用户目录或 `debug.log` 路径。
4. 配置模型服务商、API 地址、模型名称和 API Key。
5. 启动 CK3 并启用 Voices of the Court 模组。
6. 进入游戏后即可开始对话、发送信件或使用相关互动。

首次使用前，建议在 CK3 启动器中确认模组版本与游戏版本匹配，并在应用中使用提示词预览检查角色数据是否正确加载。

## 模型 API 配置

应用支持 OpenAI 兼容接口，也可以使用 DeepSeek、OpenRouter 或其他兼容服务。请至少配置：

- API Key
- Base URL（如服务商要求）
- 默认模型
- 对话、摘要和行动请求所需的参数

不要将真实 API Key 提交到 GitHub。建议通过应用设置保存本地配置，并在公开仓库中只保留示例配置或截图。

V7.6 起，Provider API Key 使用 Electron `safeStorage` 加密后写入独立的 `votc-llm-secrets` 配置文件，常规 `votc-llm-config` 只保留空 Key。启动时会在系统加密可用后迁移既有明文 Key；如果系统暂时不能提供加密能力，迁移会延期且不会删除原值，避免不可恢复的数据丢失。

## 动态历史系统

系统会从 CK3 日期中提取年份，并生成 `gameData` 历史字段，包括：

- `year`：当前年份
- `dynasty`：当前朝代
- `currentEmperor`：游戏中实际识别出的皇帝
- `currentEmperorTitle`：皇帝头衔
- `currentEraName`：年号（如果能够从头衔中识别）
- `historicalReferenceInfo`：历史时期、时代背景、事件和人物

历史认知规则还会要求模型在提及人物、事件、书籍、诗词、典故、制度或技术时，先将其出现、发生、写成、成名或流传时间与当前年份比较。年份不确定时，角色应回答“不曾听闻”或“并不知晓”，而不是用现代知识补全。

默认提示词位于：

`resources/app/default_userdata/prompts/system/default.hbs`

动态历史模板位于默认用户数据目录：

`resources/app/default_userdata/prompts/system/default.hbs`

V7.6 默认模板明确区分长期稳定记忆、当前话题记忆与本轮事实，并要求角色结合性格、关系、好感、地位和情绪自然完整作答。升级后，程序只自动迁移内容仍与旧版默认值完全一致的模板和末尾指令；玩家自行编辑过的提示词不会被覆盖。修改打包目录中的 `main.js` 后，需要完全退出并重启应用。

## 对话摘要与记忆

V7.9.1 继续使用 Memory Engine 2.5，本次未修改摘要存储、动态召回选择或人物目录格式。旧摘要导入、跨周目摘要提示和旧格式运行路径已退休；人物目录仍是唯一摘要正文来源，2.3/2.4 视角摘要继续兼容读取。主要规则是：

- 摘要 Provider 失败时不推进 rolling checkpoint，并用 recovery snapshot 保留最终失败的原始会话；
- 结构化区分事实、信念、计划、传闻、秘密、承诺和关系变化；
- 每个 `owner → counterpart` 文件接收双方在共同在场窗口内共同知晓的详细叙事片段，并附加 owner 已知且与 counterpart 直接相关的长期事项；只由 owner 单独知晓、且只与第三人有关的秘密不会复制到该配对文件；
- 只向 NPC 注入其本人应当知道的长期记忆，避免玩家私有摘要或未在场内容泄漏；
- 同一场对话内的长期稳定记忆、直接关系最近 2 条与钉住记忆使用固定内容和顺序；对话结束后的新摘要在下一场会话重新读取；
- A 与 B 对话时，NPC 只读取自己目录中的直接关系记忆；玩家不执行记忆提示词注入；
- 三人以上对话分别按每名回应角色自己的知情边界召回，不把某一参与者知道的秘密复制给其他人；
- 开场默认仅让 CK3 当前主要对话对象在场，其余已选 NPC 在首句前直接显示“请入内”。候场者不进入回应队列、不读取本轮记忆，也不会因从未入场而获得终局摘要；
- “请入内”从入内系统消息开始打开人物窗口且当轮不插队补话；“请离场”以离场系统消息为窗口右边界并立即写入可恢复快照，离场标记及其后的正文不会进入该人物视角；整场结束时再通过唯一一次结构化摘要请求生成各人物目录记忆；
- 对话中可从同一个“暂时离场”选择器选择“昏迷 / 睡着 / 暂时离开”。暂离会关闭当前半开窗口且不额外请求摘要；返回时按所选原因写入一条自我状态提示并打开新窗口。人物知道自己曾昏迷、睡着或离开，但看不到缺席区间的对话、动态召回、滚动摘要和终局摘要内容；永久离场仍不可返回；
- 玩家或任一 NPC 首次提到 C/E 等场外人物时，每名 NPC 分别从自己的目录选取该人物 1–2 条摘要并锁定为本场会话快照；后续轮次复用该快照，只有新增场外人物时扩展一次；
- 参与者和场外人物没有固定数量截断，每名 NPC 每次回复使用上下文约 8%、最少 800 且最多 2400 token 的记忆预算；
- 一场有效对话结束后，最终摘要按实际参与者写入全部有向人物配对文件；群聊镜像记录在召回时按 `finalizationId` 去重；
- 终局正文由带原始消息 ID 的 `summarySegments` 组成，本地按人物共同在场窗口投影；场景、在场人物或知情范围变化时必须拆分，睡着、昏迷、独处、自言自语和未被观察的行动不能写成所有在场者共同知情。摘要不设固定字数或段落数；可在摘要管理页设置 256–16384 Token 的最终摘要输出上限（默认 4096），该上限同样用于质量重试与恢复。缺少分段或分段没有来源消息时即使 Provider 正常结束也不会提交，而会携带质量原因自动重试；
- 每个模型返回的 `summarySegments` 和长期记忆来源 `messageIds` 都会与本场真实历史同时做存在性和范围校验；错报、串场或缺失来源时拒绝整个抽取并进入既有重试/recovery 路径，不再静默过滤后提交；
- 人物摘要目录首次召回后缓存在当前进程中；终局写入、人工编辑、单条/单文件删除和清空全部摘要后精确失效对应缓存，避免每次回复重新扫描并解析该人物全部 JSON；
- 每次终局写入后都会核验全部有向文件均含本次 `finalizationId`；任何一位参与者目录缺失文件都会使终局转为可恢复失败，禁止仅部分人物目录写入后报告成功；
- 摘要编辑、单条删除和“全部删除”只作用于当前打开的人物目录，不会修改或移除其他角色保存的同场对话记忆；
- 会话结束改由串行终局协调器提交；立即开始第二场对话不会复用上一场状态。请求 Provider 前先保存原始会话快照，退出最多等待 15 秒，超时任务在下次启动恢复；
- 直接关系、场外人物和稳定记忆只在实际命中候选时占用预算；首次话题命中最多选 1 条 Session Topic Anchor，并在整场会话中固定内容和顺序；
- 每轮以当前用户消息为主查询、最近 1–2 条消息仅作辅助。只有明确回忆意图或明确人物指向且主查询相关度达标时，才在当前用户消息之后追加 Top1 Turn Recall；独立预算默认 256、硬上限 320 Token，同回合相同回应者与查询复用缓存，剩余上下文不足 192 Token 时跳过；
- 人物提及统一使用同一匹配器：唯一称号可以指代人物、同名或同称号歧义失败关闭并记录诊断、中文长名优先，“那个人”绑定本场最近的明确第三人称对象；信件继续使用人物目录路由；
- 人物身份始终使用 CK3 数字 ID；摘要目录和对话文件只保存本名，当前头衔、称号和官职仅作为动态召回别名及摘要正文资料；
- “陛下”“殿下”或具体头衔只有在当前资料或目录中最近观察到的持有人唯一时才解析；同一称谓无法唯一绑定时不猜测、不串记忆；
- NPC 死亡后写入墓碑状态并停止继续写入该 NPC 的拥有者方向，但保留其历史摘要目录；其他人物目录中关于死者的回忆也继续保留，读档或复活后可以解除墓碑；
- 摘要管理页只展示一套“人物目录 → 与某角色的对话 → 可编辑摘要”树；“刷新 / 打开摘要文件夹 / 清除全部摘要”合并到同一标题栏，按姓名或 ID 搜索时，本人目录排在首位，并继续列出其他目录中的直接对话与相关提及；
- 结构化 episode、knowledge、pair index 继续在内部保存事实类型和知情边界，不作为第二套摘要正文 UI 重复展示。

维护工具：

- `merge-duplicate-characters.js`：合并重复角色记录。V7.6.1 不再提供旧摘要导入功能；升级或清理前请自行备份人物目录。

详细说明请参考 [docs/README.md](docs/README.md) 文档索引：

- [docs/README_摘要系统.md](docs/README_摘要系统.md)
- [docs/V7阶段优化记录.md](docs/V7阶段优化记录.md)
- [docs/V6阶段优化记录.md](docs/V6阶段优化记录.md)

## 项目结构

```text
voices-of-the-court/
├─ resources/app/out/main/main.js                    # 主程序逻辑
├─ resources/app/out/main/provider-service.js        # 模型选择、请求参数、Token 与用量编排
├─ resources/app/out/main/providers/                 # 六种模型 Provider 实现与注册
├─ resources/app/out/main/ipc/                       # Electron IPC 注册与业务入口
├─ resources/app/out/main/script-sandbox.js          # 提示词/动作脚本共享 VM 策略
├─ resources/app/out/main/window-manager.js          # Electron 窗口构造
├─ resources/app/out/main/secure-provider-secrets.js # safeStorage 密钥落盘
├─ resources/app/out/main/memory-system/             # Memory Engine 2.5
├─ resources/app/default_userdata/                   # 默认提示词、动作和本地化脚本
├─ locales/                                           # Electron 界面语言资源
├─ docs/                                               # 架构、版本、测试与 UI 文档
├─ scripts/                                             # 迁移工具和回归测试
├─ merge-duplicate-characters.js                       # 重复角色合并工具
└─ VOTC.exe                                             # Windows 应用入口
```

V7.8 在进入 V8 前完成主进程第一轮模块化：游戏数据、日志解析、旧历史参考、Prompt、摘要、信件、设置、用量统计和稳定运行服务迁出 `main.js`，入口缩减为约 1290 行的组合根。动作执行运行时胶水仍保留在入口以控制风险；IPC 名称、模型选择、请求参数、Memory Engine、提示词、设置键和用户数据格式均不改变。`historical-system/` 只预留 V8 边界，现行历史输出仍由旧 Provider 提供。

V7.8.1 修复模块拆分后首次完整对话/信件 Prompt 构建暴露的 helper 沙箱、描述缓存切分和 verbose logger 依赖缺失，并把 v7.7.2 的人物在场状态扩展为多段窗口。暂离人物不进入回应队列与动作参与者集合；返回后只恢复其缺席前记忆与返回后的新内容。

V7.8.2 完成 V7 最终收尾：TemplateEngine 的默认 helper 路径与真实打包目录对齐，`Character.removeTrait()` 会实际保存过滤结果；发布测试新增真实 `default.hbs` / `letter.hbs`、默认 helpers、脚本沙箱和两类 PromptBuilder 的完整链路冒烟，并补齐唯一 NPC 暂离及多段缺席终局投影边界。P0 热修进一步补齐 `inferGenderFromPronoun` 在 GameData 与日志解析模块中的导入，并补齐人物目录投影写入所需的 `MEMORY_ENGINE_VERSION`，避免对话/信件初始化失败或终局已消耗 Token 却只留下 recovery、未写入人物摘要目录。信件送达链路同步修复模块拆分后失效的日期日志清理调用；等待旅行天数的回信会落盘保存，重启后继续等待，且 CK3 指令文件写入失败时不会提前丢弃。

V7.8.3 将动作语义改为 fail-closed 严格白名单，明确表情动作通过本地确定性解析执行并对同回合事件去重；Memory Engine 2.5 在不改人物目录格式的前提下新增 Turn Recall 和冻结会话话题锚点。当前关系提示覆盖全部在场人物，并明确区分正式关系、当前好感和历史摘要。详细记录见 [docs/VOTC_v7.8.3_Memory_Engine_2.5实施记录.md](docs/VOTC_v7.8.3_Memory_Engine_2.5实施记录.md)。

V7.9 新增 Action Engine 3.0 三模式架构。平衡模式保持 v7.8.3 行为；性能模式增加跨轮待定意图与同类别 1–3 个模块的低/中风险 Semantic Rescue；精准模式使用轻量 Stage A 判定当前消息，再按需进入原 Stage B。三模式共用参与者绑定、验证、审批、去重和执行器。自动更新源已与上游隔离并默认禁用。详细记录见 [docs/VOTC_v7.9_Action_Engine_3.0实施记录.md](docs/VOTC_v7.9_Action_Engine_3.0实施记录.md)。

V7.9.1 是 Action Engine 3.0 的稳定性修复：真实动作消息先经过 Gate、事件解析、本地语义和参与者绑定，Semantic Rescue 仅处理未解析事件，Precision Judge 只仲裁仍歧义的候选；普通聊天不再进入 Judge。亲吻、拥抱、牵手、依偎和拒绝等改为独立社交事件，不会直接写入好感或关系。Chat Prompt 的固定锚点升级为 v4，角色基础资料和描述在同一会话内冻结并确定性序列化；长期记忆、实时关系、在场状态、历史和 Turn Recall 均保留在动态后缀，Turn Recall 仍紧随当前用户消息。Hotfix 进一步统一金币词表并加入阿拉伯数字金额的本地解析；明确完成的玩家/NPC 转账会锁定唯一对象并跳过 Stage B，计划、提议和拒收仍不执行。动作统计的全局 Stage B、Semantic Rescue、Precision Judge 调用数与模式明细统一从真实请求记录聚合。详细记录见 [docs/VOTC_v7.9.1_生产稳定性修复实施记录.md](docs/VOTC_v7.9.1_生产稳定性修复实施记录.md)。

V7.9.2 新增仅在当前对话场景内有效的 Social Consequence Engine，并完成信件链路可靠性收口。Social Context Provider 严格区分当前对话、已成功写入 CK3 的世界事件和 Memory Engine 2.5 本轮既有 Turn Recall；本地 Evidence Policy 阻止模型自行提升证据权威，并为正式关系跃迁、多人称谓、见证者知情和语义主题冷却设置 fail-closed 边界。信件链路增加有界载荷重试、全过程状态、Memory/增强 Prompt 失败时的最小 Prompt 降级，以及摘要和待投递诊断。平衡模式完全绕过新引擎，性能模式只做本地确定性推导且新增 Provider Token 为 0，精准模式最多调用 8 次独立 Social Judge，并继续复用 Action Engine 3.0 的参与者绑定、校验、审批、去重和确定性执行器。Social Judge 的稳定规则位于消息前缀，结构化 Schema 作为 Provider 请求边界独立记录；人物状态、证据、最近对话与当前消息放在末尾动态区。用量报告分别记录 Schema Token、指纹、缓存角色和实际 Provider 序列化顺序。自动化发布门禁已通过；真实 CK3 效果、Provider Token/缓存遥测及 3/4/6 人实机场景仍需人工验证。详细内容见 [设计规格](docs/VOTC_v7.9.2_Social_Consequence_Engine_设计规格.md)和 [Final Stable 修复实施报告](docs/v7.9.2-final-stable-implementation-report.md)。

V7.9.3 按冻结规格接入 Action Engine 4.0。顶层 Router 默认进入 AE4，只有显式 Engine Version 3 才整体回滚到冻结 AE3，禁止逐消息 fallback。Balanced 启动时迁移到 Performance；模式切换保留 Explicit Pending、执行历史、去重账本、Opinion Cooldown 和世界事件证据。Precision 不再经过 Candidate Gate、Event Parser、Semantic Resolver、Semantic Rescue 或 Precision Judge；每条有效 RP 对白恰好一次 Q2 Selector。Performance 仅允许确定性本地 HIT，其余最多调用一次 Compact Selector；混合句通过 `ALLOW/BLOCK/MAYBE` Guard 避免整句误杀。两种模式共享同一稳定 Action Contract 和 Proposal 执行管线，Pending 接受/拒绝/延后必须引用当前消息。Errata-001 以四态 `targetPolicy` 取代全局 `source != target`。170 条 Ground Truth Benchmark 已拆分 Action/Source/Target/Argument 等 Match、Core/Overall Recall 与 Per-Action Gate，Wrong Action 不再算 Recall，并覆盖 3/4/6 人错目标。真实 Provider Recall、缓存实测和 CK3 效果仍属于 Phase 7 人工验收，不在自动化通过前宣称 Stable。详见 [正式规格](docs/VOTC_v7.9.3_Action_Engine_4.0正式实施规格书.md)、[实机前修复清单](docs/VOCT-NEW_V7.9.3_AE4_实机前修复清单.md)、[Errata-001](docs/AE4_Spec_Errata-001_Self-Target目标约束冲突修正.md)与 [实施报告](docs/v7.9.3-action-engine-4.0-implementation-report.md)。

V7.7 在 V7.6 健康化基础上分阶段拆分主进程：第一阶段将六种模型 Provider 迁入 `providers/index.js`、92 个既有 IPC 注册迁入 `ipc/register-ipc.js`；第二阶段把 `ProviderRegistry`、`TokenCounter` 和 `LLMManager` 迁入 `provider-service.js`，通过显式依赖继续读取用户分别选择的对话、摘要和动作模型。`main.js` 由约 9477 行降至约 6612 行。动作语义同时补齐“共度春宵/鱼水之欢已发生”和“从今以后成为情人/认定灵魂伴侣”等自然完成态表达，并继续排除请求、计划、假设、回忆与失败尝试。当前仓库仍是可运行打包产物，没有能够重新生成这些文件的完整 `src` 工程，因此本阶段不伪造源码构建链。

发布测试统一由 `scripts/test-manifest.js` 声明。本地与 CI 都运行：

```powershell
node scripts\test-release.js
```

清单会覆盖全部 `test-*.js`：直接发布组、动作聚合组和 follow-up 聚合组均必须登记。V7.9.3 当前登记 72 个直接发布组并覆盖 105 个测试文件；另有 170 条 AE4 Ground Truth Benchmark，供真实 Selector 与 CK3 验收结果计算 Recall、Trigger Accuracy、Per-Action Gate 和 Stop-the-Line Blocker。

## 版本信息

- 外挂 UI 版本：v2.0.4
- 当前应用功能基线：v7.9.3
- CK3 模组版本：Voices of the Court 2.0.4
- 模组支持版本：CK3 1.18.*
- UI 主题：宫廷编年史风格（深红、暗金、羊皮纸文本层级）
- UI 主题切换：羊皮卷、骑士纹章、水墨画卷三套完整历史风格；分别拥有独立背景、边框结构、按钮造型、消息卡片、输入框、字体和滚动条，并可自动保存选择
- UI 素材生成提示词：参见 [docs/UI_ASSET_PROMPTS_2.0.3.md](docs/UI_ASSET_PROMPTS_2.0.3.md)
- 当前重点：V7.9.3 / Action Engine 4.0；Memory Engine 2.5、外挂 UI 2.0.4 与 CK3 Workshop 2.0.4 保持不变

## 已知限制

- 历史知识核验依赖模型自身的年代知识，提示词规则可以显著降低穿越，但不能替代外部历史数据库。
- CK3 日志格式、角色头衔语言和本地化文本变化时，可能影响年份或皇帝识别。
- DeepSeek 等服务商的上下文缓存由服务端管理，命中率会受到请求前缀、模型、账号隔离和缓存生命周期影响。
- 人物摘要目录是 Memory Engine 2.5 的可见长期记忆数据；清理或迁移前请先备份 `%APPDATA%/VOTC/votc_data/conversation_summaries`。
- 结构化记忆质量仍受摘要 Provider 的 JSON 遵循能力影响；新终局请求解析失败时会自动重试，连续失败则保留 recovery snapshot，旧恢复快照仍兼容自然语言回退。

## 文档入口

版本变更顺序统一维护在 [CHANGELOG.md](CHANGELOG.md)，架构、设计、实施报告和阶段记录统一从 [docs/README.md](docs/README.md) 进入。

## V6 阶段优化记录

V6/V6.x 的完整阶段记录统一维护在 [docs/V6阶段优化记录.md](docs/V6阶段优化记录.md)。

后续 V6/V6.x 阶段只在该文档中追加或更新，README 仅保留此索引。

## V7 阶段优化记录

V7/V7.x 的 Memory Engine 与后续优化统一记录在 [docs/V7阶段优化记录.md](docs/V7阶段优化记录.md)。

## 许可证

模组文件遵循项目原有许可证。Voices of the Court 2.0 Mod © 2026 Durond 与 MrAndroPC，采用 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 授权。

Electron、Chromium 及其他第三方组件分别遵循其随附许可证，详见 `LICENSE.electron.txt` 与 `LICENSES.chromium.html`。

## 致谢

感谢 Voices of the Court 原作者、CK3 Mod 社区，以及所有参与测试、翻译、历史提示词和摘要系统改进的用户。
