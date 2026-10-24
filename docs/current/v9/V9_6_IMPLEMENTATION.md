# V9.6 双模块与 Bridge 合同实施

日期：2026-10-24。Core／App／UI：9.6.0 候选。用户补充优先于[设计原文](V9_6_DESIGN.md)中的结构示例：官方上游基线为 **2.0.4**，V8 起维护的本地 Mod 为 **2.0.5**。Workshop 与 Runtime 分开维护、构建和分发；本轮只推送 GitHub，不上传 Steam，也没有安装器、Bootstrap、自动下载或主动 Probe。

## 源码归属和构建

- `ck3-mod/` 纳管完整 97 文件 Mod 源码。固定上游为 `Voices-of-the-Court/votc_mod@0cf4845a69f9e8633333ca04e558afe8216490f2`，保留其 `LICENSE.MD`（CC BY-SA 4.0）和既有归属；Runtime 原许可证边界保持。
- `scripts/audit-v96-source/source-dispositions.json` 逐项记录 19 项文本差异、5 项本地新增及 3 项上游仓库元文件的处置。保留已获用户确认的维护快照，不推断作者，不把 BOM／换行差异算作逻辑修改。原始快照树指纹为 `cf872f6a6d79878dc6106e312919b78f641971dda026bc3cdb1c5c926f040756`。
- 相比安装快照，本轮只在 `common/on_action/votc_load_boundary.txt` 的同一 effect 内、现有 LOAD_SESSION 后插入一行只读 Hello。其余 96 文件逐字节相同；既有字段顺序、导出内容、计时器、RunFile 消费、ACK、回读和回执不改。
- `build/ck3-mod-inputs.json` 为独立 Mod 清单；`build/runtime-inputs.json` 只映射 Runtime。Mod 不含 EXE；Runtime 不把 `ck3-mod/` 当作运行资源。
- Mod 候选 97 文件、12,996,288 字节，payload 树 SHA-256 为 `d3bd9b0ecca796f5cbe404672e3b10ff2fbb1ad51fb31698f51f4f0a1ede58fd`。`sourceRevision`／`artifactSha256` 明确采用按相对路径排序的 `path + NUL + size + NUL + fileSHA + LF` 清单哈希，指向实际 payload 树，**不是 ZIP 哈希**。
- 生成器默认只预览清单，`--write` 才更新清单；候选构建只创建 `.build/` 下尚不存在的目录。审计和验证接受参数路径，公共 JSON 不输出本机绝对路径；路径逃逸、链接、大小写冲突、多余文件、未知可执行文件或哈希不符会失败。

## Bridge 1.0 与会话证据

`contracts/ck3-bridge/` 固定 Hello schema、独立 manifest、配对矩阵和 8 个合成夹具。新声明协议 1.0 与既有 Memory 3.0／摘要存储 2.5 无关。官方 Action 2.0.3 不变。Mod/upstream 版本用于归属与展示，不做固定相等检查；协议范围与逐能力 revision 才决定兼容性。

Hello 字段依次为 `schema/protocol/mod/upstream/revision/load/caps`。严格拒绝重复、非法或超长字段；只允许 `x_` 可选扩展。未知普通能力忽略并记诊断，未知 `!` 必选能力不兼容；已知能力超出支持范围只影响依赖功能，除非声明为必选。

服务在启动、换路径和文件身份变化时从 EOF 读取，不能把历史 Hello 当作当前加载证明。新 LOAD 行建立进程内 generation，即使载入 token 文本相同也重建。身份、偏移、尾部及 LOAD／Hello 边界指纹共同检测轮转、截断、同尺寸改写和固定 stat 时间下的改写。重检只读取新增日志与校验指纹，不追溯信任旧日志。

`helloSeen` 与 `helloBoundToCurrentSession` 分开；后者要求语法有效、token 匹配和日志身份已知。协议不支持也可绑定，但仍不兼容。对外 DTO 不带载入 token、路径、正文、真实人物或存档身份。

无 Hello 或超时采用 `LEGACY_UNVERIFIED`，保留既有受测业务检查，不全局关闭聊天。已知声明不兼容时，由同一个服务按功能检查；不复制版本判定到业务层。

## 能力生产者、消费者与保护

以下路径均相对仓库根。每项 revision 为 1，字段保持原顺序；[探索通信矩阵](V9_6_BRIDGE_PROTOCOL_MATRIX.md)及标记索引提供完整旧链路取证。

| 能力 | 生产者／依赖 | Runtime 消费与缺失行为 |
| --- | --- | --- |
| character_export | `ck3-mod/common/scripted_effects/log_gamedata_v3*_effect.txt` | `game-data/log-parser.js`；阻止依赖人物资料的对话生成 |
| trait_export | `ck3-mod/common/scripted_effects/log_character_v2_effect.txt` | `game-data/log-parser.js`；在新资料投影及生成前标为未知，不扩大披露权限 |
| native_date | `ck3-mod/common/scripted_guis/votc_runtime_clock.txt` | `letters/letter-manager.js`；日期依赖的信件生成／写入不越过门禁 |
| load_session | `ck3-mod/common/on_action/votc_load_boundary.txt` | Bridge 会话隔离及现有信件日期会话；不继承旧证据 |
| runfile_consumer | `ck3-mod/gui/custom_gui/votc_runtime_bridge.gui`、注册文件与旧对话消费路径 | `actions/run-file-manager.js`；新 Action／Letter 在副作用前检查 |
| run_ack | Runtime 生成 ACK 脚本、Mod 消费后由 CK3 执行 | `letters/letter-manager.js` → RunFileManager 对账；无匹配 ACK 不确认 |
| action_readback | `actions/action-effect-writer.js` 生成同命令回读脚本，依赖 Mod 人物列表／log_income | `conversation/conversation.js`；缺失或跨 generation 只返回 UNCONFIRMED |
| letter_receipt | `letters/letter-manager.js` 生成脚本并触发 Mod `message_event.362` | 原回执校验／唯一投递／摘要门禁保持，缺失不绕过 |
| official_recollection_export | `ck3-mod/common/scripted_effects/log_character_v2_effect.txt` 的原生记忆导出 | `game-data/game-data.js`；实时检查能力，不同步或读取本次不可用的官方追忆，原文不翻译 |

新功能检查放在模型工作流入口与最终 transport／写入之前；已完成投递的既有恢复和摘要流程不因诊断被清空。RunFileManager 在原子写入成功后以可选、异常隔离回调登记实际发送 generation；排队不算发送。ACK 只有现有队列接受 kind/id 后才可记录通道；Receipt 先匹配并持久化；动作只有真实回读确认后才记录通道。跨 generation 的命令在最终效果确认前再次核对。

没有修改排队 TTL、持久化先于写入、UTF-8 BOM 原子替换、命令去重、STALLED、旧会话隔离或未知效果不重放。Bridge 观察失败不能让队列保存／恢复失败，也不清除等待命令。

## 原诊断页接入

Main 提供 `bridge:getState`、`bridge:redetect` 两个无参数只读 IPC，Preload 仅暴露对应两方法。`bridge-diagnostics.js/css` 直接挂载原诊断页，无重复工作区。包含中英状态、版本／能力／功能、操作指引、只读重检和白名单脱敏复制；并发读取合并，过期响应与卸载回调不提交。

五条通道独立显示：新 LOAD 行可证明 debug.log 被读取；剪贴板只观察实际 IN 信号；ACK、动作回读、信件回执由各自业务验证记录。Hello 不把这五条一起置为正常；Receipt 不表示玩家已阅读信件。

三主题沿用透明背景和现有 token。Workshop 文件在磁盘上存在不代表 CK3 已载入；Runtime 后启动也不会信任旧日志。详细配对与验证边界见[验证报告](V9_6_VERIFICATION.md)和[双模块使用说明](V9_6_RELEASE_PAIRING.md)。
