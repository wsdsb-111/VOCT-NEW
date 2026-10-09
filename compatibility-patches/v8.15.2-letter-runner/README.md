# V8.15.2 信件日期执行器补丁

App 与 CK3 Mod 继续独立发布。此目录记录 App V8.15.2 本次热修依赖的游戏侧补丁，不能仅更新 App 就宣称信件投递已修复。

目标：VOTC Workshop Mod `3346777360`，现有 `mcc_event_v2.9998`、`talk_event.9999.desc` 与 `votc_load_epoch` 合同保持不变。

- `gui/scripted_widgets/votc_runtime_bridge.txt`、`gui/custom_gui/votc_runtime_bridge.gui`、`common/scripted_guis/votc_runtime_clock.txt`：唯一主动日期路线。原生 registry 自动挂载透明全局 widget，两秒循环直接执行只读日期 scripted GUI；非对话场景只轮询正式 `votc.txt`，不再执行 `letters.txt`。日期不依赖 Run File、`.9998` 或 after-lobby；对话中仍读取，投递文件留给既有对话 consumer。
- `gui/custom_gui/letters_runner.gui`：旧目标彻底停用，仅保留透明空壳兼容窗口名；没有计时器、console command 或 blur 设置。新桥未加载时也不重启旧路线，应检查配套文件并重启游戏。
- `gui/event_window_widgets/event_window_widget_message_clear.gui`：移除写信事件 `.9999` 创建 widget 时单独删除计时组件的旧逻辑，避免它清掉子事件 `.9998` 刚重建的 runner。
- `gui/event_windows/votc_invisible_event.gui`：旧事件仍可引用窗口，但它不再创建 runner 或计时器。
- `common/on_action/votc_load_boundary.txt`：父钩子通过 `on_actions` 追加唯一子钩子。保留 `on_game_start` 载入边界与 after-lobby 一次 rich DATE，取消延迟创建旧 runner；App 的 stale/close ACK 不再写日期载体或排队 rearm。
- 载入 epoch 先在不存在时初始化，再递增，避免未设置变量警告。没有修改 Artifact 创建 Effect、ACK 去重或 Summary 接收门禁，也没有重发既有信件。

本轮已应用到本机 Mod。同功能升级到 Workshop 时需携带以上七个配套文件，不能只带旧 runner；Steam 更新可能覆盖本机修改。必须完全退出并重启 App 和 CK3，才能停止内存中的旧 GUI 循环。最新证据与未完成的实机验收见[退役报告](../../docs/v8.15.2-letter-timer-retirement-report.md)。诊断从 A2 开始，旧 A1 停用；已有待投递、未知 Effect 与历史 ACK 证据不清空、不重放。

离线检查可验证补丁合同，不能验证游戏引擎执行 GUI。实机 Gate：非对话场景日期持续推进；先对话后关闭也持续推进；等待信件到期后只有一件回信宝物、内容窗口和一条已接收摘要；加载另一存档不使用旧会话 DATE。
