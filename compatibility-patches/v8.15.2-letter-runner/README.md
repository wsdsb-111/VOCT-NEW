# V8.15.2 信件日期执行器补丁

App 与 CK3 Mod 继续独立发布。此目录记录 App V8.15.2 本次热修依赖的游戏侧补丁，不能仅更新 App 就宣称信件投递已修复。

目标：VOTC Workshop Mod `3346777360`，现有 `mcc_event_v2.9998`、`talk_event.9999.desc` 与 `votc_load_epoch` 合同保持不变。

- `gui/custom_gui/letters_runner.gui`：对话中暂停 Run File 执行，但保留状态循环；对话结束后自动继续。轮询周期仍为两秒，不每轮创建新 widget。
- `common/on_action/votc_load_boundary.txt`：载入边界仍由 `on_game_start` 标记；玩家执行器启动移至原版明确用于玩家已确定后的 `on_game_start_after_lobby`，一天后创建 runner；同时直接记录一次当前 DATE，冷启动不依赖待恢复的 Run File。
- 没有修改 Artifact 创建 Effect、ACK 去重或 Summary 接收门禁，也没有重发既有信件。

本轮已应用到本机 Mod。同功能升级到 Workshop 时需携带以上两项；Steam 更新可能覆盖本机修改。重新启动 CK3 并载入存档才能载入 GUI/on_action 修改。

离线检查可验证补丁合同，不能验证游戏引擎执行 GUI。实机 Gate：非对话场景日期持续推进；先对话后关闭也持续推进；等待信件到期后只有一件回信宝物、内容窗口和一条已接收摘要；加载另一存档不使用旧会话 DATE。
