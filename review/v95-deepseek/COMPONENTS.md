# V9.5 Visual Components

所有视觉模块只消费 `v95-view-v1` ViewModel；不读 IPC、不写存储、不发网络请求。

## 1. 挂载入口

```js
import { mountView } from ".../v95/visual/memory-visual.js";

const instance = mountView(container, view, { t, emit, iconRegistry });
instance.update(nextView);
instance.destroy();
```

- `container`: 任意 HTMLElement；模块会替换其子节点为自己的 `.v95-ui.v95-view` 根。
- `view`: 通过 `validateView` / `assertView` 的合法 View。
- `t(key, params)`: Codex `createUiTranslator` 返回的函数；视觉层不读写语言设置。
- `emit(intent)`: Codex 容器入口；视觉层只发送白名单 Intent，容器仍须再次校验。
- `iconRegistry`: `{ hasIcon, renderIcon }`；缺省时回退 `defaultIconRegistry`。
- `update(nextView)`: 同一 `kind` 的刷新／分页／状态变化；键控更新，保留焦点、输入值和滚动。
- `destroy()`: 移除根、行、监听器；不触碰宿主其他节点。
- 返回对象还带 `element`，仅供测试／容器取引用。

### 八个模块

| 文件 | `kind` | 展示重点 |
|---|---|---|
| `conversation-visual.js` | `conversation-feed` | 系统／玩家／NPC 气泡、生成中状态、消息操作 |
| `memory-visual.js` | `memory-list` | Legacy Summary 时间线、日期／来源、来源操作 |
| `knowledge-visual.js` | `knowledge-facts` | 已授权事实、来源徽标、编辑／详情 |
| `worldline-visual.js` | `worldline-timeline` | 当前事实／历史节点、只读语义 |
| `letter-visual.js` | `letter-list` | 信件卡、阶段→效果双状态、审查 |
| `action-visual.js` | `action-activity` | 动作队列／ACK／UNKNOWN／CONFIRMED |
| `provider-visual.js` | `provider-diagnostics` | 指标卡、native／estimated／unknown、进度 |
| `settings-visual.js` | `settings-section` | 只读／选择／开关／文本控件，CHANGE_FILTER |

`index.js` 额外导出 `mountByKind(container, view, ctx)`、`MOUNTERS`、`VISUAL_VERSION`。

## 2. View / Row 字段

严格读取冻结字段，不补造业务事实：

- View：`contractVersion`、`kind`、`state`、`scopeTag`、`revisionTag`、`titleKey`、`rows`、`emptyTextKey`、`errorCode`、`pagination`。
- Row 基础：`id`、`title`、`subtitle`、`dateText`、`badge`、`icon`、`disabled`、`actions`。
- 可选：`role`、`text`、`streaming`、`timeText`、`metric`、`control`、`stage`、`effectState`、`queueTimeText`。
- `pagination = { page, pageSize, total }`；视觉层只显示当前页，不扩页、不请求 total 的所有行。

### 行操作

只有 `row.actions` 中出现的 action 才会生成对应按钮；`disabled`、`state !== "ready"` 时不发送：

| action | 显示 | 发送 |
|---|---|---|
| `OPEN_DETAIL` | 详情图标按钮 | `{type, viewKind, rowId, scopeTag, revisionTag}` |
| `OPEN_SOURCE` | 来源图标按钮 | 同上 |
| `SELECT_ROW` | 选择图标按钮 | 同上 |
| `REQUEST_EDIT` | 编辑图标按钮 | 同上 |
| `REQUEST_APPROVAL` | 带文字的审查按钮（danger tone） | 同上 |
| `CHANGE_FILTER` | 不生成按钮；由 `row.control` 控件触发 | 带 `rowId`、`filterKey:'value'`、`value` |
| `CHANGE_PAGE` | 底部分页 | `{..., page}` |
| `REQUEST_REFRESH` | 标题栏刷新 | `{...}` |

视觉层对连续同 action 点击有 350ms 去抖；最终防重仍由 Codex 容器与 Main 负责。

### 控件（`row.control`）

| type | 控件 | 触发 |
|---|---|---|
| `readOnly` | 只读值 + aria-label | 不发送 |
| `select` | `<select>`；空值显示 `common.unavailable` | 选择变化发 `CHANGE_FILTER` |
| `toggle` | 原生 checkbox + `role="switch"` | 切换发 `CHANGE_FILTER` |
| `text` | 文本框；`change` 时发 | 不发每次按键 |

`control.options[].labelKey` 走 `t`；`helpTextKey` 走 `t`。settings 行标题作为控件 aria-label；不改 Codex 的配置键。

### 状态映射

- `state`：`idle` / `loading` / `refreshing` / `ready` / `empty` / `error` / `stale`。
- `loading`：3 行 skeleton + `aria-busy=true`。
- `refreshing`：保留当前 rows，顶部显示刷新条；不遮挡、不替换旧内容。
- `empty`：使用 `view.emptyTextKey`，不伪造行。
- `error` / `stale`：使用 `errorTextKey(view.errorCode)`；`stale` 用 warning 语义；提供刷新按钮但不自动重试。
- `idle`：中性 `common.unavailable` 占位，不伪装加载或成功。
- 机器状态：`QUEUED / DISPATCHED / ACKNOWLEDGED / CONFIRMED / UNCONFIRMED / UNKNOWN / SOURCE_BOUND / BLOCKED / STALLED`；未识别字符串一律 `status.UNKNOWN`。
- **ACKNOWLEDGED 不使用确认勾**；只有 `CONFIRMED` 使用确认语义。`UNKNOWN` 使用虚线/中性视觉。
- letter／action 的 `stage` 与 `effectState` 用 `阶段 → 效果` 的箭头连接；相同机器码合并为一个 chip，避免重复。

## 3. 图标注册表

```js
import { hasIcon, renderIcon, listIcons, defaultIconRegistry } from ".../v95/icons/icon-registry.js";

hasIcon("conversation");                       // true
renderIcon("unknown-offline-icon", { size: 18, decorative: false, label: "Unknown" });
```

- 50 个原创图标；冻结 `ICON_NAMES` 的 18 个全部覆盖。
- 未知 ID 回退到 `unknown` 图标，并在 `svg[data-icon-fallback="unknown"]` 标记；不加载外链。
- 只创建 SVG DOM；没有全局 sprite id／`<use>` 外链／字体图标。
- `decorative` 默认 true；需要语义时传 `label`，生成 `role="img"` + `<title>`。

## 4. 对话框

```js
import { mountDialog, mountConfirmDialog } from ".../v95/visual/dialog-shell.js";

const dialog = mountDialog(document.body, {
  titleKey: "memory.title",
  title: legacyRow.title,
  icon: "memory",
  body: detailElement,
  t,
  actions: [
    { labelKey: "common.close", tone: "surface", onClick: () => dialog.close("close") }
  ],
  onClose: () => {}
});
```

- `mountDialog(host, options) → { element, panel, close, update, destroy }`。
- `host` 默认 `document.body`；对话框层自带 `.v95-ui`，主题通过 `:root[data-votc-theme]` 生效。
- `variant`: `detail` / `confirm`；`size`: `small` / `medium` / `large`。
- 无 actions 时自动提供 footer 关闭按钮；顶部也有图标关闭按钮。
- 焦点陷阱、`Escape`、遮罩（`dismissible`）、body 滚动锁、关闭后焦点恢复。
- **只调用传入的回调；不自行 emit／不执行动作。** 确认按钮是否发送 `REQUEST_APPROVAL` 由 Codex 容器决定。
- `mountConfirmDialog` 是 `danger` 确认版式；`onConfirm` 返回 `false` 可阻止默认关闭。
- 建议 Codex 在 scope／revision 改变时主动 `dialog.close()`，避免旧对话框写新作用域。

## 5. 页面切换

```js
import { swapView } from ".../v95/visual/view-transition.js";

await swapView(host, () => {
  content.replaceChildren();
  mountNextView();
}, { duration: 130 });
```

- `swapView` 先给容器加 `v95-swap-out`，等待 `duration` 后执行 render，再加 `v95-swap-in`；不会触碰容器以外的 DOM。
- `prefers-reduced-motion: reduce` 时立即执行；不阻塞业务。
- 真实数据／容器状态由 Codex 管理；helper 只做过渡。

## 6. CSS / 主题 / 密度

- `design-tokens.css` + `v95-ui.css`；全部规则位于 `.v95-ui` 或 `.v95-*` 前缀。
- 主题：`:root[data-votc-theme="parchment|knight|ink"]`，只桥接既有 `--ui-*`；不覆盖既有背景。
- 密度：在 `.v95-ui` 根上加 `data-density="compact"`；默认 standard。
- 高度：`.v95-view` 为 100% 高；宿主应当提供有高度、`min-width:0` 的容器；列表在 `.v95-list-slot` 内独立滚动。
- 容器查询：620px / 440px 断点控制行操作、settings 控件、conversation 气泡；由**容器宽度**而不是窗口宽度决定。
- 减少动态：所有动画在 `prefers-reduced-motion: reduce` 下关闭；`swapView` 同步降级。

## 7. 挂载示例（Codex 容器）

```js
import { mountByKind } from "../v95/visual/index.js";
import { defaultIconRegistry } from "../v95/icons/icon-registry.js";

const visuals = new Map();
function render(kind, view) {
  const host = document.querySelector(`[data-v95-slot="${kind}"]`);
  if (!host) return;
  const existing = visuals.get(kind);
  if (existing) existing.instance.destroy();
  const instance = mountByKind(host, view, {
    t: runtime.t,
    emit: intent => container.handleIntent(intent),
    iconRegistry: defaultIconRegistry
  });
  visuals.set(kind, { instance });
}
```

- 同一 `kind` 的 `update` 只调用 `instance.update(nextView)`；不要为分页/刷新重新 mount，以保留滚动与焦点。
- 语言切换必须重新 `mount`（`t` 在挂载时固定）；主题切换不需要。
- `emit` 的结果不参与视觉判断；不要以 emit 成功显示“已执行”。
