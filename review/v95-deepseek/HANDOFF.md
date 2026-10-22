# V9.5 Visual Delivery · DeepSeek Harness

**状态：视觉交付候选，等待 Codex Review / 接线。不是 V9.5 发布通过，也不是 Electron 或 CK3 验收。**

- 基线：VOCT-NEW `main` `713e9f614ab233fc3e9d0041cbb93018a54f6886`
- 共享契约：`v95-view-v1` **revision 1**（冻结说明 `docs/current/v9/V9_5_VIEW_CONTRACT_FREEZE.md`）
- 交付日期：2026-10-22
- 交付方式：同一工作区目录 + `MANIFEST.json`；另附源码压缩包 `review/v95-deepseek/v95-deepseek-src.tar.gz`（不含截图）
- 运行环境：一次一个本地静态 Showcase；无 IPC、无网络、无用户数据

## 1. 所有权与文件范围

只新增／修改以下范围：

```text
src/app/renderer/v95/visual/**
src/app/renderer/v95/icons/**
review/v95-deepseek/**
```

没有修改 `src/app/main/**`、`src/app/preload/**`、`index.html`、`assets/index-Dn3qWlAB.js`、`ui-comfort.css`、既有主题图片、`v95/contracts/**`、`v95/i18n/**`、`v95/state/**`、`v95/adapters/**`、`v95/containers/**`、`build/runtime-inputs.json`、`resources/app/out/**`、CI 或测试清单。契约、字典和 fixture 只读引用。

## 2. 已交付内容

- **Design tokens**：`design-tokens.css`，作用域 `.v95-ui`，桥接既有 `--ui-*`；三主题形态差异只通过前缀样式扩展。
- **图标系统**：50 个原创内联 SVG（冻结 `ICON_NAMES` 的 18 个全部覆盖）；`hasIcon` / `renderIcon` / 未知图标离线回退；无 sprite 全局 ID、无外部字体／CDN。
- **列表底座**：`list-shell.js`、`row-components.js`、`status-indicator.js`、`icon-button.js`；键控行更新、焦点／滚动保留、长文本换行、分页、空／加载／刷新／错误／过期／idle 状态。
- **八类 View**：`conversation-feed`、`memory-list`、`knowledge-facts`、`worldline-timeline`、`letter-list`、`action-activity`、`provider-diagnostics`、`settings-section`；统一 `mountView(container, view, { t, emit, iconRegistry }) → { update, destroy }`。
- **对话框**：`dialog-shell.js`；焦点陷阱、Escape／遮罩关闭、滚动锁、焦点恢复、详情／确认两种版式、主题皮肤、退出动效；不执行任何业务副作用。
- **页面切换**：`view-transition.js` 的 `swapView(container, render)`，短淡出／淡入，尊重 reduced-motion。
- **离线 Showcase**：`showcase.html` + fixtures + 本地 server；三主题、中英、7 状态、八类页面、图标目录、对话框演示、Intent 日志。
- **测试**：`tests/run-ui-tests.mjs` 22 项；`tests/capture-matrix.mjs`、`tests/capture-states.mjs` 截图矩阵。

## 3. 验证记录（实际执行）

| 命令／项目 | 结果 |
|---|---|
| `node review/v95-deepseek/tests/run-ui-tests.mjs` | **22/22 PASS，exit 0** |
| `node review/v95-deepseek/tests/capture-matrix.mjs` | 三主题 / 中英 / 1280×720 / 1600×900 / 1920×1080 / 2560×1440 / 1067×600（模拟 150% CSS 视口）/ 390×844 / 对话框；0 runtime、0 console error、0 failed request |
| `node review/v95-deepseek/tests/capture-states.mjs` | empty / loading / error / stale / refreshing / idle；每类 9 个 view（8 kind + page switch） |
| `node --check` 所有新增 JS | 通过 |
| 静态排查 | 无 `eval` / `new Function` / `innerHTML` / `localStorage` / `fetch` / 外部 URL / 生产中文硬编码 |
| 离线 | 所有请求均指向本地 server；无 CDN、字体、图标外链 |
| 长文本 | 官方 fixture 的 80 字姓名、2000 字副标题、无空格长串；420px 容器无横向溢出 |
| 生命周期 | mount → update → destroy ×3，容器清空；焦点在 update 后保留 |
| 对话框 | role=dialog / aria-modal、Tab 焦点陷阱、Escape、遮罩关闭、焦点恢复、滚动锁移除 |
| Contract | 所有 fixture 通过 `assertView`；只发送白名单 Intent |

## 4. 截图

`review/v95-deepseek/screenshots/`：

- `matrix-parchment-zh.png`、`matrix-knight-zh.png`、`matrix-ink-zh.png`
- `matrix-knight-en.png`
- `size-1280x720.png`、`size-1600x900.png`、`size-1920x1080.png`、`size-2560x1440.png`
- `dpi-125.png`、`dpi-150.png`（**模拟**：缩小 CSS viewport；实际 Windows 125%／150% 未执行）
- `mobile-390.png`
- `dialog-detail.png`、`dialog-confirm.png`
- `state-{empty,loading,error,stale,refreshing,idle}.png`

## 5. 已知限制 / NOT_RUN

以下项目没有通过本次视觉交付完成，不得写成 PASS：

- `NOT_RUN`：真实 Electron 内加载 CSS/ESM、`index.html` 接线、`build → verify → deploy → verify --deployed`。
- `NOT_RUN`：真实 Windows 100%／125%／150% 系统 DPI；截图使用缩小 CSS viewport 模拟。
- `NOT_RUN`：生产 i18next 实例；Showcase 使用同键的本地 demo translator。接入必须使用 Codex 的 `t`。
- `NOT_RUN`：真实 CK3、桌面鼠标／输入穿透、overlay focus、Soak、Provider 实际响应。
- `NOT_RUN`：屏幕阅读器实机、完整键盘走查（基础 Tab/Escape 已在浏览器中验证）。
- `NOT_RUN`：性能 P50/P95、列表 5 万行真实渲染；视觉层只渲染 ViewModel 当前页行，不做前端扩页。
- 视觉模块不自动打开业务对话框；Codex 容器负责在 `OPEN_DETAIL` 后挂载对话框并二次校验 scope／revision。

## 6. 主要风险与回滚

1. **CSS 顺序**：Codex 需在 `ui-comfort.css` 之后加载 `design-tokens.css` 与 `v95-ui.css`。我们已用 `.v95-ui` 作用域与足够选择器权重，但旧 `button` 全局规则仍可能影响自定义 demo 控件；生产类名均带 `v95-` 前缀。
2. **语言切换**：视觉实例在 `mountView` 时捕获 `t`；Codex 切 `uiLanguage` 时需重新 `mount`（或规定新的 update 合同），不能只改属性。我们没有读写语言设置。
3. **容器高度**：`.v95-view` 默认 `height:100%`；宿主需给一个可确定高度的容器，列表在内部滚动；若宿主高度 auto，页面会按内容增长。
4. **现代 CSS**：使用 `:has()`、`color-mix()`、container queries、`text-wrap: balance`；目标 Electron／Chromium 需支持（项目当前 Chromium 满足预期，但未在打包 EXE 验证）。
5. **回滚**：删除两处 CSS link 与 visual 模块 import 即可完全回退；没有数据迁移、存储写入或 Main 变化。

## 7. Codex 接线请求

详见 [`INTEGRATION_REQUESTS.md`](INTEGRATION_REQUESTS.md)。最小步骤：

1. 在 `index.html` 的 `ui-comfort.css` 之后加载 `v95/visual/design-tokens.css`、`v95/visual/v95-ui.css`。
2. 在 Codex 容器中按 kind 相对 import 八个 visual 模块；传入 `t`、`emit`、`iconRegistry`。
3. 把 `domain-container` 的 ViewModel 传给 `mountView`；`update` 只在同一 kind 的列表刷新时调用。
4. 语言切换时重新 mount 八个 visual；主题切换只改 `data-votc-theme`，无需 remount。
5. 在 `OPEN_DETAIL` 等 Intent 后由 Codex 打开／关闭 `mountDialog`。
6. 把所有新增文件登记到 `build/runtime-inputs.json` 并生成 `out/`；不要手工编辑生成资源。

## 8. 交付清单

- [`COMPONENTS.md`](COMPONENTS.md)：组件 API、字段、状态、Intent。
- [`UI_DESIGN_DECISIONS.md`](UI_DESIGN_DECISIONS.md)：三主题、图标、列表、弹窗、动效与无障碍理由。
- [`LOCALE_KEY_REQUESTS.md`](LOCALE_KEY_REQUESTS.md)：实际使用的翻译键；无新增键请求。
- [`INTEGRATION_REQUESTS.md`](INTEGRATION_REQUESTS.md)：Codex 接线点与构建登记。
- [`MANIFEST.json`](MANIFEST.json)：路径、SHA-256、来源、依赖。
- [`showcase.html`](showcase.html)：本地离线演示（`node review/v95-deepseek/serve.mjs`）。
