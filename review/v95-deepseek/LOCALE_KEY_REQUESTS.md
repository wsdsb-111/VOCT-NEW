# V9.5 Locale Key Requests

**结论：视觉层不需要新增翻译键。** 所有显示文本都来自 Codex 冻结的 `v95/i18n/locales/{zh-CN,en-US}.js`；视觉层不写死中文，也不读取语言设置。

## 1. 直接使用的键

### common

```text
common.unavailable
common.noResults
common.loading
common.refreshing
common.stale
common.error
common.page          {{page}} {{total}}（total = 总页数）
common.previous
common.next
common.refresh
common.close
common.cancel
common.detail
common.source
common.edit
common.approve
common.select
common.filter
common.unknown
```

`common.unavailable` 也是 `t` 缺失时的最后回退；`settings` 的 select 空值显示它。

### navigation（标题栏 eyebrow）

```text
navigation.conversation
navigation.memory
navigation.knowledge
navigation.worldline
navigation.letters
navigation.actions
navigation.provider
navigation.settings
```

### 各领域标题／状态

```text
conversation.title, conversation.streaming
conversation.player, conversation.npc, conversation.system   # 仅图标 catalog metadata
memory.title, memory.verified
knowledge.title
worldline.title
letters.title
actions.title
provider.title
diagnostics.title, diagnostics.native, diagnostics.estimated,
diagnostics.unknown, diagnostics.cacheRate
settings.title
```

- `view.titleKey` / `emptyTextKey` / `row.badge.textKey` / `row.control.helpTextKey` / `option.labelKey` 都是 ViewModel 提供的键，视觉层不修改。
- `diagnostics.cacheRate` 只用于进度条 aria-label 的默认前缀；真实指标标题来自 row.title。

### status（机器码 → 显示）

```text
status.IDLE, LOADING, REFRESHING, READY, EMPTY, ERROR, STALE,
QUEUED, DISPATCHED, ACKNOWLEDGED, CONFIRMED, UNCONFIRMED,
UNKNOWN, SOURCE_BOUND, BLOCKED, STALLED
```

`row.stage` / `row.effectState` 是机器码；未识别代码显示 `status.UNKNOWN`，不改写回业务状态。

### errors

由 `errorTextKey(code)` 映射，覆盖冻结的 12 个错误码：

```text
errors.STALE_CONTEXT, CAMPAIGN_CHANGED, CONVERSATION_CHANGED,
REVISION_CONFLICT, SOURCE_REVOKED, PERMISSION_DENIED,
PROVIDER_UNAVAILABLE, REQUEST_CANCELLED, EFFECT_UNKNOWN,
IPC_UNAVAILABLE, VALIDATION_ERROR, UNKNOWN_ERROR
```

## 2. 没有新增／没有修改

- 没有新增 `common.retry`、`common.save`、`common.stage`、`common.effect` 等键；stage/effect 之间用箭头与状态文本表达，不引入额外标签。
- 没有把 settings 的 `uiLanguage` / `promptLanguage` / `gameLanguage` 文案写进视觉层；它们来自 ViewModel 的 `labelKey` / `helpTextKey`。
- 没有把中文文案放进生产 JS。Demo 的合成事实文本也按 `zh-CN` / `en-US` 分别生成，不依赖生产字典缺失回退。

## 3. 运行检查

```powershell
node review/v95-deepseek/tests/run-ui-tests.mjs
```

测试会检查：

- 页面不存在 `undefined`、`[object Object]`、`{{...}}`、原始 key；
- 空／加载／错误／过期／刷新态都有翻译；
- 中英切换后无缺失文本；
- 图标未知回退不抛错。

如 Codex 最终字典的 key 与本清单有差异，请以冻结字典为准调整 `t` 调用；不要增加视觉层私有 key。
