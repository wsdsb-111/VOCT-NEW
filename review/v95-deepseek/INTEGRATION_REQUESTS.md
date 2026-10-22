# V9.5 Integration Requests · Codex

DeepSeek 不修改下列 Codex 文件；以下为最小接线请求。

## 1. 样式加载

在 `src/app/renderer/index.html` 中，`ui-comfort.css` **之后**加入：

```html
<link rel="stylesheet" href="./v95/visual/design-tokens.css">
<link rel="stylesheet" href="./v95/visual/v95-ui.css">
```

- 顺序很重要：`design-tokens.css` 先、`v95-ui.css` 后；两者都在 `ui-comfort.css` 后。
- `v95-ui.css` 只作用于 `.v95-ui`；唯一全局规则是 `html.v95-dialog-open` 的滚动锁。
- 不修改既有主题图片、背景或 `ui-comfort.css`。

## 2. 模块加载

只在 Codex 容器／主 UI 接线文件中相对 import；不要写入 `index-Dn3qWlAB.js` 的未审查整文件。

```js
import { mountByKind, MOUNTERS } from "../v95/visual/index.js";
import { defaultIconRegistry } from "../v95/icons/icon-registry.js";
```

或按 kind 分别 import：

```js
import { mountView as mountMemory } from "../v95/visual/memory-visual.js";
```

所有模块：

```js
mountView(container, view, { t, emit, iconRegistry })
```

- `t` 必须是 `createUiTranslator(i18n, uiLanguage)` 的当前函数。
- `emit` 应接到 Codex 的 `domain-container.handleIntent` / 容器入口；视觉层不再次执行。
- `iconRegistry` 可传 `defaultIconRegistry`；如 Codex 有自己的 registry，保持 `{ hasIcon, renderIcon }`。
- 返回 `{ update, destroy }`；同一 kind 刷新调用 `update`，不要重复 mount。
- **语言切换必须重新 mount**；视觉层在 mount 时捕获 `t`，不读取语言状态。
- 主题切换只改 `:root[data-votc-theme]`，无需 remount。

## 3. 容器与高度

- `.v95-view` 需要 `height:100%`；宿主 slot 必须有确定高度并设置 `min-width:0`，否则内部列表无法独立滚动。
- 建议示例：

```css
.v95-slot { height: 100%; min-height: 0; min-width: 0; display: flex; flex-direction: column; }
```

- `view` 的 `rows` 必须已由容器分页；视觉层不会为 `total=50000` 造 50000 个 DOM。

## 4. Intent 路由

视觉层只发送：

```text
OPEN_DETAIL, OPEN_SOURCE, SELECT_ROW, REQUEST_EDIT, REQUEST_APPROVAL,
CHANGE_PAGE, CHANGE_FILTER, REQUEST_REFRESH
```

- 行操作带 `rowId`；CHANGE_FILTER 额外带 `filterKey:'value'`、`value`；CHANGE_PAGE 带 `page`。
- 视觉层已检查 `row.actions`、`row.disabled`、`view.state==='ready'`，但 Codex 仍需按 `validateIntent` 二次校验。
- 视觉层不发送 `EXECUTE_ACTION`、`FORGET_SOURCE`、`RETRY_EFFECT`，不传函数或配置对象。
- `emit` 的返回值不用于显示“成功”。

## 5. 对话框接线

`OPEN_DETAIL` / `OPEN_SOURCE` / `REQUEST_APPROVAL` 之后由 Codex 容器决定是否打开对话框：

```js
import { mountDialog, mountConfirmDialog } from "../v95/visual/dialog-shell.js";

const dialog = mountDialog(document.body, {
  title: detail.title,
  subtitle: detail.subtitle,
  icon: "memory",
  body: detailContent,     // Node，不是 HTML 字符串
  t,
  actions: [
    { labelKey: "common.close", tone: "surface", onClick: () => dialog.close("close") }
  ],
  onClose: () => { activeDialog = null; }
});
```

- 对话框不自动执行审批、Forget、重试或任何 IPC；确认按钮的 onClick 只调用 Codex 提供的回调。
- scope/revision 变化时关闭旧对话框；不要在新作用域复用旧详情。
- 主题属性需在 `<html>`；dialog layer 自己带 `.v95-ui`。

## 6. 页面切换

若 Codex 的标签页容器希望统一过渡：

```js
import { swapView } from "../v95/visual/view-transition.js";
await swapView(host, () => { mountNextView(); });
```

- 只是视觉过渡，不替代容器状态机；不自动保存／切换模型／语言。
- 视觉模块自身在 mount 时也有轻微入场动画；两者可二选一。

## 7. 构建与资源

请 Codex：

1. 将 `v95/visual/**`、`v95/icons/**` 加入 `build/runtime-inputs.json` 的显式映射（路径按实际构建映射规则）。
2. 运行 `build-runtime.js` → `verify-runtime-build.js` → `deploy-runtime-build.js` → `verify-runtime-build.js --deployed`。
3. 在隔离 Windows 环境做完整 EXE 冷启动、鼠标／焦点、主题切换、语言切换、真实 CK3 检查。
4. 将本文文件加入 V9.5 review 文档索引；不要把截图当作 CK3／Electron 验收。

## 8. 需要 Codex 确认

- Renderer 是否继续用 `index.html` 显式 link CSS（当前假设是）。
- `domain-container` 的 `t` 是否在语言切换时新建 translator 并 remount visual。
- 八个 View 的 `OPEN_DETAIL` 容器是否已有，或由 Codex 新建。
- 是否接受 `.v95-view` 使用 `height:100%` 作为标准；若宿主高度不同请给出实际容器。
- `container` 的实际宽度和最小高度；必要时提供截图或从真实 Renderer 取 DOM。

## 9. 不请求 DeepSeek 改动的文件

- `index.html`、主 UI JS、`ui-comfort.css`、既有主题图片、`v95/contracts/**`、`v95/i18n/**`、`v95/state/**`、`v95/adapters/**`、`v95/containers/**`、`main/**`、`preload/**`、`build/**`、`resources/app/out/**`、CI。
- 如需修改这些文件，由 Codex 接入或发布 integration request，不由视觉侧直接改。
