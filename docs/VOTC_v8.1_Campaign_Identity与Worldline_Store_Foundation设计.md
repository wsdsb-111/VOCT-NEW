# VOTC v8.1 Campaign Identity + Worldline Store Foundation 设计

## 1. 目标与基线

V8.1 以 V8.0 Historical Baseline 2.0 为基线，只建立可靠的存档身份和世界线持久化地基：

```text
CK3 save-scoped campaign token
→ CampaignIdentityResolver
→ dynamic_history/<campaignId>/worldline.json
```

成功标准：

- 同一 CK3 存档跨应用重启得到相同 `campaignId`；
- 不同 token 得到不同 `campaignId`，数据目录互相隔离；
- 没有可靠 token、token 畸形或旧模组未提供 token 时，只生成进程级 session identity，绝不持久化；
- `worldline.json` 使用 schema version 1、原子写入，损坏文件和未知 schema 均不覆盖；
- V8.1 保持 Shadow Mode，不改变 Prompt、Memory、Conversation、Action、Letter、Relationship 或 Run Command Queue 行为。

## 2. 非目标

以下能力属于后续阶段，本版本不实现：

- V8.2 GameStateSnapshot 与 Ruler Resolution；
- V8.3 Historical Figure Resolver；
- V8.4 Divergence Ledger；
- V8.5 Historical Fact Validity；
- V8.6 Historical Context Projector；
- Memory campaign 化、Prompt 新增区块或缓存重排。

V8.1 不创建 `divergences.json`、`figure-resolution.json` 或 Prompt 世界线文本。

## 3. CK3 Campaign Token 协议

Workshop 模组新增持久化全局变量组成的 12 位十进制随机 token。每一位只在变量不存在时通过 CK3 `random_list` 初始化；全局变量由存档保存，因此应用重启不会改变 token。

日志协议：

```text
VOTC:CAMPAIGN/votc8c-123456789012
```

三条现有 GameData 输出路径都必须在 `init` 之后立即输出该行。应用仅接受严格格式：

```text
votc8c-[0-9]{12}
```

随机 token 用于身份隔离，不是安全凭证。复制同一存档形成的分支继承相同 token，视为同一 campaign；世界线分叉由 V8.4 的 append-oriented ledger 表达。

## 4. Campaign Identity

新增 `historical-system/campaign-identity.js`：

```js
{
  campaignId: "ck3-<sha256 前 32 hex>",
  source: "ck3_mod_token",
  persistenceAllowed: true,
  tokenFingerprint: "<sha256>"
}
```

规则：

- 不把原始 token 写入磁盘；
- 不使用 characterId、玩家名、当前年份或它们的组合推导持久化身份；
- 同 token 的 identity 在不同 resolver 实例中稳定；
- 无 token/非法 token 返回 `session-<uuid>`，`persistenceAllowed=false`；
- 同一应用进程内 session identity 稳定，应用重启后允许变化。

## 5. WorldlineState Schema

V8.1 的最小 `worldline.json`：

```json
{
  "schemaVersion": 1,
  "campaignId": "ck3-...",
  "identity": {
    "source": "ck3_mod_token",
    "tokenFingerprint": "..."
  },
  "mode": "shadow",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

validator 必须拒绝：

- 未知 `schemaVersion`；
- 文件内 `campaignId` 与目录身份不一致；
- session identity 落盘；
- 非法 ID、非法时间、未知 mode 或缺失字段。

## 6. WorldlineStore

新增 `historical-system/worldline-store.js`，根目录由组合根注入：

```text
%APPDATA%/VOTC/votc_data/dynamic_history/
└─ <campaignId>/
   └─ worldline.json
```

写入纪律：

1. 在同目录写入唯一临时文件；
2. flush/close 后使用 rename 替换目标；
3. 失败时清理临时文件；
4. 已有文件先读取并完整校验；
5. JSON 损坏、未知 schema 或身份不匹配时返回显式错误，不重建、不覆盖。

没有可靠 identity 时，`loadOrCreate()` 返回 `persistence_skipped`，并且不得创建 `dynamic_history` 目录。

## 7. Shadow 集成

新增最小 `dynamic-history-service.js` 作为 V8 唯一入口：

```js
updateFromGameData(gameData)
getWorldlineState()
getDiagnostics()
```

日志解析器只负责读取 `VOTC:CAMPAIGN` 并设置 `gameData.campaignToken`。组合根在一次 GameData 解析完成后调用 DynamicHistoryService：

- 将只读 `historicalCampaignIdentity` shadow metadata 附加到 GameData；
- 可靠 token 才加载或建立 WorldlineState；
- 持久化错误进入 diagnostics 并 fail-closed，但不得阻断既有 Conversation/Letter 解析；
- PromptBuilder、模板、Memory、Action 和 Letter 不读取该 metadata。

## 8. 验证矩阵

自动化必须覆盖：

1. 同 token 跨 resolver/应用重启模拟得到同 ID；
2. 不同 token 得到不同 ID 和目录；
3. 缺失、畸形 token 仅 session identity，且磁盘零写入；
4. worldline 首次创建、重载、原子替换及临时文件清理；
5. 损坏 JSON、未知 schema、campaign mismatch 均不覆盖原文件；
6. 三条 CK3 GameData 路径都初始化并输出 token；
7. LogParser 能读取 campaign token；
8. `default.hbs`、Prompt stable segments、Memory/Action/Letter/Queue 全部既有回归不变；
9. 统一 `test-release.js` 全通过。

真实 CK3 Gate：

- 同一存档完全退出应用后重新对话，ID 与目录不变；
- 两个独立新存档产生不同 ID；
- 使用未提供 token 的旧模组时对话正常且不生成持久化目录；
- 保存、读档和人物继承后 token 不变。

自动化和静态 CK3 脚本检查不能替代上述实机 Gate。
