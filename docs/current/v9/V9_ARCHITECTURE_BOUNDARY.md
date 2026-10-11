# V9.0 当前架构与权限边界

V9.1 更新：可编辑源现为 `src/app/`，`resources/app/out` 是经校验生成的资源；本文件下方保留 V9.0 审查快照。最新路径与阶段归属见 [V9.1 架构移交](V9_1_ARCHITECTURE_HANDOFF.md)，构建与版本见 [源码构建](V9_1_SOURCE_BUILD.md)。本次没有改变下方业务权限边界。

日期：2026-10-11。下表是实际打包源码地图，非V9.1重建成果。

发行版本：项目 V9.0／核心 9.0／App 包 9.0.0／VOTC Workshop Mod 2.0.5。Memory Engine 4.0、协议 3.0、摘要存储 2.5、Official Action 2.0.3 保留；独立 Three-Mod 仍为 1.0.6。当前版本更新记录见[版本对齐](V9_VERSION_ALIGNMENT.md)。

| 责任 | 当前生产入口 | 数据权限／方向 |
| --- | --- | --- |
| 启动组合根 | `resources/app/out/main/main.js` | 构造服务与IPC；不把out称为可重复构建的正式src |
| 对话／Presence | `conversation/conversation.js`、`conversation-manager.js` | 当前会话、合法在场、每NPC响应与终局；调用Memory/Worldline/Provider |
| 认知与叙事 | `memory-system/memory-engine.js`、`memory4-engine.js`、`memory4-store.js` | Campaign×Owner；观察／披露／Forget先于Prompt；Derived不能覆盖原始事实 |
| 当前事实／历史 | `worldline/worldline-service.js`、`historical-system/` | CK3当前事实只读；历史时点／定义身份有界，不写游戏状态 |
| Provider | `provider-service.js`、`providers/` | 接受授权后的Prompt；诊断context不能进入HTTP、缓存锚点或Prompt |
| 动作 | `actions/run-file-manager.js`、`run-command-recovery.js` | FIFO、UTF8 BOM原子替换、未知效果不重放，ACK与CONFIRMED区分 |
| 信件 | `letters/letter-manager.js`、`letter-log-reader.js`、`letter-date-session-scanner.js` | 实际DATE/session、Effect/ACK/收信回执、一次归档；不乐观确认 |
| UI／IPC | `out/preload/preload.js`、`main/ipc/register-ipc.js`、`out/renderer/` | UI不直接写Memory；指标输入严格白名单且不含文本；不同进程只传相对时长 |
| 原生桥 | `compatibility-patches/v8.15.2-letter-runner/` | VOTC自身Bridge，保留至V9.6，当前运行文件在Workshop独立发行 |
| 可选兼容 | 独立 CK3-Three-Mod-Compatibility 工程 | 不属于上述运行依赖；自有官职政策、源码与QA，VOTC只消费合法导出 |

V9.0只建立诊断、CI与项目边界；ConversationService/JsonRepository等规划接口没有实现，V9.1—V9.6分阶段推进。Memory4显示4.0、协议3.0、摘要存储2.5及官方Action2.0.3合同保持。
