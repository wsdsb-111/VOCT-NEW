# V9.5 DeepSeek Harness · 协作与交付约定

状态：**合同 `v95-view-v1` revision 1 已冻结；视觉层完成，等待 Codex Review / 接线**
基线：`713e9f614ab233fc3e9d0041cbb93018a54f6886`（main）
时间：2026-10-22 15:30 起（Asia/Shanghai）
文档：已阅读 Codex §2／§4 与 DeepSeek 视觉文档全文。

## 1. 交付目录

- 视觉生产文件：`src/app/renderer/v95/visual/**`
- 图标生产文件：`src/app/renderer/v95/icons/**`
- 离线 Showcase、fixtures、截图、测试、HANDOFF：`review/v95-deepseek/**`

不会写入：`src/app/main/**`、`src/app/preload/**`、`index.html`、`assets/index-Dn3qWlAB.js`、`ui-comfort.css`、既有主题资源、`v95/contracts/**`、`v95/state/**`、`v95/i18n/**`、`v95/adapters/**`、`v95/containers/**`、`build/runtime-inputs.json`、`resources/app/out/**`、CI、用户数据。

## 2. 当前计划（等待合同期间先做）

1. `v95/icons/icon-registry.js`：离线 SVG 注册表、`hasIcon` / `renderIcon`、未知图标安全回退、三主题 currentColor。
2. `v95/visual/design-tokens.css` + `v95-ui.css`：只作用于 `.v95-ui`，桥接 `--ui-*`，三主题与 100/125/150% 缩放。
3. `v95/visual/list-shell.js` / `row-components.js` / `status-indicator.js` / `icon-button.js`：列表五态、分页、长文本、焦点、行内操作。
4. `v95/visual/dialog-shell.js`：详情／确认弹窗的焦点陷阱、Escape、遮罩、滚动锁、进入/退出动效。
5. 八个 `*-visual.js`：`conversation-feed`、`memory-list`、`knowledge-facts`、`worldline-timeline`、`letter-list`、`action-activity`、`provider-diagnostics`、`settings-section`。
6. `review/v95-deepseek/showcase.html` + fixtures + screenshots + tests：三主题 × 中英 × 四尺寸 × 五态。
7. `HANDOFF.md`、`COMPONENTS.md`、`UI_DESIGN_DECISIONS.md`、`INTEGRATION_REQUESTS.md`。

> 2026-10-22 16:15 更新：`v95-view-v1` revision 1 已冻结；以下为最初协调记录。最终交付、测试与接线见 [`HANDOFF.md`](HANDOFF.md)。

## 3. 需要 Codex 冻结／提供

请优先落地并通知以下内容，我会立即对齐，不自行另造字段：

1. `v95/contracts/view-contract.v1.js` 与 `async-states.v1.js` 的冻结正文。
2. 8 个 `kind` 的 zh-CN / en-US 合成 fixture：至少各含 `ready / empty / loading / error / stale`；包含 80 字人名、2000 字摘要、无空格长路径、未知时间/来源、重复姓名不同 Runtime ID。
3. `t(key, params)` 的实际 key 清单或字典片段（`common / navigation / conversation / memory / knowledge / worldline / letters / actions / provider / diagnostics / settings / status / errors`），以及缺失 key 的约定回退行为。
4. 是否有 ViewModel 的**可选展示字段**用于富行渲染。目前 §4 只冻结了 `rows[].{id,title,subtitle,dateText,badge,icon,disabled,actions}`；若 contract 会提供以下任一项，请给出准确字段名；若没有，我会严格只渲染已冻结字段并用中性版式：
   - conversation：role / name / text / streaming / timeText
   - diagnostics：metric / value / unit / estimateKind / progress
   - settings：control 类型、options、helpText
   - action/letter：stage、effectState、queueTimeText
5. Renderer 实际模块加载方式：是否接受 ES Module `mountView(container, vm, { t, emit, iconRegistry })`，以及 CSS 由 `index.html` 引入还是构建拼接。若只能走 Codex 的接入文件，请给我确切的接入点；我不会改 `index.html` / 主 JS。
6. 主题属性确认：生产环境仍是 `:root[data-votc-theme="parchment|knight|ink"]` 吗？我的 CSS 只读取该属性，不写它。

## 4. 初步集成约定（可改）

- CSS 根容器：`.v95-ui`；变量桥接 `--ui-text / --ui-muted / --ui-accent / --ui-line / --ui-field / --ui-surface`。
- 所有组件只创建／销毁自己的 DOM；监听器随实例清理；不读 `window.*API`、不写 `localStorage`、不自行 `fetch`。
- 只发送白名单 Intent：`OPEN_DETAIL`、`OPEN_SOURCE`、`SELECT_ROW`、`CHANGE_PAGE`、`CHANGE_FILTER`、`REQUEST_REFRESH`、`REQUEST_EDIT`、`REQUEST_APPROVAL`、`CANCEL_UI`；不发送执行／Forget／重试类事件。
- 弹窗仅提交 `REQUEST_APPROVAL` / `CANCEL_UI` 的意图，实际确认与副作用仍由 Codex 容器执行。

## 5. 当前阻塞与不阻塞项

- 阻塞最终字段对齐：合同与 fixture 未冻结。
- 不阻塞：图标系统、token、列表骨架、弹窗、动效、三主题展示可先用 §4 语义样例开发；合同到位后按实际字段适配，不把样例当生产合同。
