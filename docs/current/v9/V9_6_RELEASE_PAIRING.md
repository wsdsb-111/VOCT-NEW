# V9.6 双模块配对和维护

Runtime 在 GitHub 发布；Mod 以 `ck3-mod/` 为 Steam Workshop 源码基准，独立构建和发布。本轮只推送 GitHub，没有发布 Steam，也没有替换安装中的 Workshop 目录。候选 Mod 位于本机 `.build/ck3-mod-build/`，仅为离线构建产物。

| Runtime | Mod | 自动化覆盖／状态 |
| --- | --- | --- |
| 9.6.0 | 本地维护 2.0.5、无 Hello | LEGACY_UNVERIFIED；原路径专项回归通过，不等于实机新配对验收 |
| 9.6.0 | 维护 2.0.5 + Bridge revision 1 | schema 1／协议 1.0／九项能力 revision 1；合成握手与业务门禁通过，真实 CK3 待验证 |
| 9.6.0 | 格式合法、不同产品基线、相同协议与能力 | 不按产品版本号拒绝；合成夹具通过，不能据此宣传任意上游版本受支持 |
| 9.6.0 | 缺少可选能力 | DEGRADED；只限制依赖功能 |
| 9.6.0 | 不支持的协议、非法声明、未知必选能力 | INCOMPATIBLE；保留诊断及既有队列证据，阻止依赖工作流 |
| 旧 Runtime | Bridge revision 1 Mod | Hello 独立标记不改旧字段；真实旧 Runtime／CK3 配对仍待验证 |

官方上游基线为 2.0.4；维护 Mod 版本保持 2.0.5；Bridge revision 为 1。它们与 Runtime 9.6.0、Official Action 2.0.3、Memory 3.0、摘要存储 2.5 分别维护。协议变更需更新两个 manifest 和矩阵；普通 Runtime UI 更新不必改 Mod 版本。

## 只读诊断步骤

1. 打开原有“诊断／Diagnostics”，查看兼容状态和五条独立通道。
2. 使用含 Hello 的 Mod 时，先启动 Runtime，再在 CK3 新建／载入存档，以产生可验证的新 LOAD／Hello。之后启动 Runtime 时，旧日志不会自动获信任；需要新的游戏载入边界。
3. “重新检测当前会话”只读取日志；不会运行 Effect、写 `votc.txt`、重试命令、修改日期、调用 Provider 或清空投递。
4. Steam 已下载／磁盘已替换但游戏未重载时，以实际载入证据为准。重检不能把磁盘版本当成游戏已加载版本。
5. 无 Hello 的旧维护 Mod 可沿旧合同运行，显示“旧版／未验证”。通道 UNKNOWN 只表示没有足够证据，不能直接当成故障，也不能宣称正常。
6. 支持声明、已观察 ACK、真实动作效果确认、信件回执与玩家阅读是不同证据；按原业务状态处理 STALLED 和待确认命令，不为更新或回滚自动重放。

## 构建和发布边界

```powershell
node scripts/verify-ck3-mod-source.js
node scripts/build-ck3-mod-source.js --output-dir .build/ck3-mod-build-new
node scripts/verify-ck3-mod-source.js --mod-dir .build/ck3-mod-build-new
node scripts/runtime-dependencies.js
node scripts/build-runtime.js
node scripts/verify-runtime-build.js
node scripts/deploy-runtime-build.js
node scripts/verify-runtime-build.js --deployed
```

Mod 输出目录必须尚不存在；工具不会覆盖已有候选。Runtime 部署仍要求退出 VOTC。测试和候选产物不包含用户配置、API Key、存档、真实日志、摘要或分析数据。

以后发布 Workshop 前，先完成 CK3 新档／读档、Hello、人物资料／Traits、日期、Action ACK／回读、Letter Receipt、旧 Runtime 配对和恢复／Soak 的人工 Gate，再记录真实 CK3 版本和证据。当前 manifest 的 `verifiedVersions` 为空；本版为候选，不能称为 Full Freeze。
