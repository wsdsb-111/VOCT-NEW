# V9.6 当前通信与依赖矩阵

日期：2026-10-24，Runtime 060e336与[本机Mod指纹](V9_6_SOURCE_INVENTORY.md)。以下为当前源码确认；频率、事件顺序与效果仍待引擎验证。

路径约定：`R:`是仓库`src/app/main/`；`A:`是`src/app/default_userdata/actions/standard/`；`M:`是Mod根目录。完整定位见[VOTC字面标记及符号引用索引](v96-marker-source-index.json)：270处`VOTC:`源码引用、61类IN数据及972行Mod符号引用。索引包括注释、解析正则和动态脚本模板，**不是270个实际协议，也不是可达性证明**。

## 通道与格式

| 通道／格式 | Producer → Consumer | 触发、会话与恢复合同 |
| --- | --- | --- |
| debug.log：`VOTC:IN/;/<type>/;/<位置字段>` | M `log_gamedata_v3_effect.txt`、`log_gamedata_v3s_effect.txt`、`log_gamedata_v3l_effect.txt`、`log_character_v2_effect.txt` → R `game-data/log-parser.js:37,142` | 互动调用8999／9000／9001后导出；解析整个日志，以最后init构造GameData。不是后台连续全量同步；依赖行顺序与init先行 |
| debug.log：`VOTC:CAMPAIGN/votc8c-<12digits>` | M `votc_campaign_identity_effect.txt`及三种导出 → `log-parser.js:137` | 存档内12个campaign数字flag；不等于一次载入session或存档分支 |
| 剪贴板短信号：`VOTC:IN` | 8999／9000／9001事件描述＋`event_window_widget_talk_v2.gui:6` → R `main.js:579–645,1131` | 100ms监听，保留／恢复原剪贴板；新会话随后读取日志。无request ID／可靠消息队列，不能当ACK |
| debug.log：`VOTC:LOAD_SESSION/;/votc-load-<epoch>` | M `common/on_action/votc_load_boundary.txt:5–24` → R `letters/letter-manager.js:330`、date scanner及Worldline probe | 新游戏／读档钩子递增存档内epoch。需同时绑定日志身份和边界偏移；同一旧存档重载可能重复字符串，不能当全局唯一ID |
| debug.log：`VOTC:DATE/;/<totalDays>/;/<shortDate>` | M `votc_runtime_clock.txt:1`及after-lobby钩子 → R `letter-manager.js:367`、`letter-date-session-scanner.js:283` | 全局GUI声明约2秒循环；数字totalDays是信件时间依据，shortDate为可读文本。轮转／截断／读档按现有身份与边界重建，不沿用旧日期 |
| 文件：`<CK3用户目录>/run/votc.txt` | R `actions/run-file-manager.js:249–285` → M全局Bridge及`talk_window_v2.gui:59–84` | UTF-8 BOM、临时文件原子rename；全局约2秒、对话约0.4秒消费。多入口重复轮询依赖同command ID游戏变量去重 |
| debug.log：`VOTC:RUN_ACK/<KIND>/<commandId>` | **R生成脚本，CK3执行输出** → `letter-manager.js:345`、`actions/run-command-recovery.js` | 回读匹配队列头ID／kind，持久化后推进。已写无ACK进入STALLED／恢复核对，未知效果不自动重放；不是Mod固定Hello |
| 剪贴板：`VOTC:EFFECT_ACCEPTED` | RunFile末尾触发M `mcc_event_v2.9003`＋talk widget → R `main.js:1142` | 仅界面提示；Main明确仍等待command-specific debug ACK，不能替代状态确认 |
| debug.log：`ACTION_BEGIN/ACTION_EFFECT/<id>`、`ACTION_SOURCE/;/<id>`、`ACTION_TARGET/;/<id>`、`ACTION_BINDING_FAILED`、`ACTION_INSUFFICIENT_GOLD` | R `run-file-manager.js:251`、`actions/action-effect-writer.js:53–59`生成 → `action-command-readback.js:7–42` | 同命令BEGIN—ACK内采集，8MiB尾部上限；交错／重复观察拒绝确认。金币／意见前后值经Mod `log_income`或动态IN行输出 |
| debug.log：`TRIBUTARY_ESTABLISHED/REJECTED`、`TRIBUTARY_CONTRACT_CONFIRMED/<group>`、`...REJECTED/ROLLBACK_FAILED` | A `z_becomesTributaryOf.js:55–59`、`z_changesTributaryContract.js:82–126`生成 → R `action-command-readback.js:22–28` | CK3寄附与契约Effect特定结果；同命令关联，不是通用执行成功信号 |
| debug.log：`VOTC:LETTER/;/<body>/;/<letterId>/;/<sendDay>/;/<delay>`＋剪贴板`VOTC:LETTER` | M `message_event.360/361`、本地化描述＋message widget → R `log-parser.js:121`、`letter-manager.js:324,1275`、`main.js:1145` | 先导出人物再写信。日志／剪贴板可能都触发；同letterId相同载荷复用，冲突不覆盖；不等于到期送达 |
| debug.log：`VOTC:LETTER_RECEIPT/;/<letterId>/;/<receiptToken>/;/<campaign>/;/<playerId>/;/<recipientId>/;/<day>/;/<date>` | **R `letter-manager.js:1539–1564`生成**，CK3创建宝物后输出 → `letter-receipt-recovery.js`、`processLogLine/clearLettersFile` | 同时依赖receipt token、人物、campaign、日志身份与载入边界；摘要与清理另有门禁。不是“玩家已阅读”的证据 |
| 剪贴板：`VOTC:LETTER_ACCEPTED` | **R生成Effect触发M `message_event.362`**，widget复制描述 → R `main.js:1153` | Main进入receipt处理／清理；正式receipt和summary门禁仍在。只搜Mod内部会误判362无调用方 |
| debug.log：`LETTER_TRANSPORT/A或B/<id>`、`LETTER_DIAG/A3/PRE或POST或SCOPE_OK/<id>`、`LETTER_DIAG/B或C或D/<id>` | R `letter-manager.js:2100`生成隔离诊断脚本 → 同文件361–365行 | 诊断ID关联，不是版本握手；本轮未运行诊断或写真实载体 |
| `DATE_PRODUCER/REARMED或BLOCKED/<id>`、`TEST_CHAR`、`TEST_DATE`、`IDLE_NOOP` | R旧兼容／诊断／安全空载体模板或解析保留，见字面索引 | 不据此声明当前Mod能力；无业务效果成功含义，不能用于Hello升级判断 |
| `CLOSE`、`BACKGROUND`、本地化中的短`DATE` | M保留描述／旧GUI路径 → Main剪贴板switch没有这三种case | CLOSE窗口无复制动作；BACKGROUND缺少已确认触发链。列为legacy／未闭合路径，不把本地化存在当活跃通道 |

## IN字段及数据边界

`/;/`是位置分隔符，没有统一JSON envelope、能力header、完整frame长度或frame checksum。UTF-8／Unicode文本依赖CK3日志与Node读取；多行memory／letter由parser拼接，`#ENDMULTILINE`结束资源／关系明细。用户正文、人名、官方memory会随CK3语言变化，不能当机器ID；自由文本含分隔符是应加入fixture的边界。

- init位置字段：playerID、playerName、aiID、aiName、date、带固定前缀的scene、location、locationController、totalDays；消费点`game-data/game-data.js:33–34`。固定`substring(11)`也属于隐式合同。
- character为固定位置属性列，包含ID／姓名／称谓／当前年龄、技能、政体与宫廷字段等；消费点`game-data/character.js:18–25`。后续字段不能随意插列。
- 61类均找到parser case，详见JSON `inCategories`；资源类、memory、trait、秘密、关系、父母、子女、兄弟姐妹与persona等是同一日志协议的子类型，不是61个独立文件。
- Trait允许旧无key与新有key两种行，`log-parser.js:935–949`按长度决定偏移。今后直接追加字段可能误触旧长度启发式，不能宣称“任意尾部扩展兼容”。
- 官方追忆：Mod导出`memory` → `Character.memories` → `memory-system/official-recollection-provider.js`；保持CK3原文，不从UI语言生成另一份事实。
- Presence为App对话状态及IPC join／leave，不是现有Mod的`presence_v2`日志能力。Mod选择列表与原生头像槽位也是不同合同：日志人数不等于0..5六个头像槽的容量。

## 文件、事件与符号硬依赖

| 依赖 | 两端用途 |
| --- | --- |
| `mcc_characters_list_v2`及顺序 | Mod导出候选人物；R ActionEffectWriter按ID在游戏列表绑定source／target，玩家绑定root；列表清空／换场影响旧效果有效性 |
| `log_income = yes` | R动作模板调用M scripted effect回读金币；不能只保留GUI与ACK而删除该effect |
| `mcc_event_v2.9002/.9003` | App关闭／效果封装与原生窗口生命周期；9003生成剪贴板提示 |
| `message_second_scope_letter_*`、`votc_letter_*`、`votc_latest_letter`、`message_event.362`、`votc_huixin_title*` | 写信线程、收件人scope、回信宝物、显示事件、本地化标题；App动态Effect引用，属于跨端合同 |
| `votc_last_action_command`／`votc_last_run_command`与`flag:<commandId>` | R生成、游戏保存，避免重复消费；不能因升级清除未知命令证据 |
| `votc_campaign_digit_01..12`、`votc_load_epoch`、GUI变量`votc_native_bridge_active` | campaign、载入标记、GUI注册分别不同；最后一个未被Runtime配对读取，不是正式握手 |

`gui/scripted_widgets/votc_runtime_bridge.txt:1`确实注册全局GUI，非仅有注释；实际引擎是否实例化仍未测。`letters_runner.gui`已退役，Mod未找到`run letters.txt`消费器；当前R LetterEffectTransport默认及loadState都强制VOTC模式（14、29行），Main 942–944行注入RunFileManager。legacy letters.txt方法存在，不等于生产仍走该路线。

## 额外的只读依赖与路径

- CK3用户目录由用户设置提供：`config/settings-repository.js:201–214`；日志为`logs/debug.log`，RunFile为`run/votc.txt`。不是从Workshop目录推导。
- `modLocationPath`有存取及IPC，但静态搜索只找到设置读取／写入，没有用它验证当前加载Mod或版本。
- Worldline直接监控／解析`save games/autosave.ck3`或所选路径，读取CK3游戏根及`dlc_load.json`启用Mod描述、本地化与历史资料（`worldline-service.js:345`、`localization-resolver.js:73–117`）。完整在途路线未见由对话日志导出，不应凭位置字符串推断。
- 应用数据位于Electron `userData/votc_data`，包括队列、信件、Legacy、配置及分析；`config/paths.js:5`。与安装／Workshop目录分离，统一交付不能把个人数据写回Steam安装树。
- 当前fork自动更新关闭：`app/app-updater.js:3–9`。存在单实例锁及active-win焦点监控；统一后的启动器需要复用该行为，而非同时启动两个Runtime。

本轮没有读真实日志或存档。特别是LOAD文本重复风险，现有Letter scanner已经使用文件身份、offset、轮转与anchor信息；Worldline `readLiveProbe`只复合使用birthtime／ctime弱身份与绝对偏移，没有在此路径发现持续的截断世代跟踪。原地重写到同位置可能碰撞仍是静态风险推断，不是已证实故障；不能将未来Hello所需的完整世代绑定误写成现有Letters“只按字符串、已发生串档”。
