# V9.5 UI Design Decisions

本文只说明视觉层决策；业务状态、权限、语言持久化与集成仍归 Codex。

## 1. 目标与约束

- 保留 VOTC 的历史宫廷／叙事气质与三套主题资产，不把界面改成通用 SaaS 后台。
- 优先解决：页面切换的连续感、弹窗的阅读舒适度、列表状态层级、长文本与窄容器、图标语义一致性。
- 三主题不是三套品牌：同一结构、同一语义，只改变材质与少量的时代语法。
- 不新增前端框架、不引入外部字体／图标 CDN、不读写 `window.*API`。

## 2. Token 桥接

`.v95-ui` 内定义 `--v95-*`，默认映射既有 `--ui-*`：

```text
--v95-text / muted / accent / line / field / surface / hover / selected
--v95-danger / success / warning
--v95-panel-bg / row-bg / field-bg / scrim / shadow
--v95-radius / panel-radius / control-h / space / motion
```

主题只增加形态差异：

- **parchment（游牧／羊皮纸）**：软圆角、暖阴影、Georgia／宋体标题；列表留白更大，badge 圆润。
- **knight（中世纪宫廷）**：0 圆角、金色 hairline、深阴影；控件与弹窗边界清晰，像金属／石质铭牌。
- **ink（宋代书墨）**：KaiTi 标题、直角、偏移阴影、细线；列表更轻，像纸页上的条目。

没有把具体色值另起一套；浅色主题仍用 host 的 `--ui-surface` / `--ui-text`，只改变表面透明度、圆角、字体与阴影。

## 3. 层级与精度

- **View 标题**：10px 语义 eyebrow + 18–21px 标题；eyebrow 与标题文本相同时自动隐藏，避免“对话／对话”重复。
- **Row**：34px 图标 rail + 主内容 + 右侧操作。标题 15px／600，副标题 11.5px，正文 13px；行内状态与 meta 分层。
- **时间／来源**：低对比 meta，不与标题抢层级；日期与来源用独立小图标，未知留空，不补造。
- **操作**：普通行用 28px 图标按钮并带 `aria-label`／tooltip；审查使用显式文字按钮；动作不因颜色被误读。
- **状态**：badge 同时有图标与文字；`UNKNOWN` 虚线；`ACKNOWLEDGED` 用回执图标，不用成功勾；`CONFIRMED` 才用勾。
- **长文本**：`overflow-wrap:anywhere` + `white-space:pre-wrap`；标题、副标题、正文均不强制截断核心信息；列表由固定高度容器内部滚动。
- **空态／错误**：错误、过期、空、idle 使用居中面板；`loading` 使用 skeleton；`refreshing` 保留旧行并在顶部插入细状态条，不阻塞阅读。

## 4. 八类呈现

- **Conversation**：系统居中虚线气泡；玩家右对齐、暖色 accent-soft；NPC 左对齐。角色图标与时间、生成中状态保持可见；操作在 hover／focus 才出现，触屏常显。
- **Memory**：竖向时间线 + 卡片；日期与来源在行内；来源操作与详情并列可见。
- **Knowledge**：事实卡片，左侧 3px 状态色；未知/失效与已核验并列，不改变权限。
- **Worldline**：与 Memory 共用时间线语法，但节点颜色偏向 warning；只读事实与历史记录并列，排序只来自 ViewModel。
- **Letters**：信封图标 + 左侧 accent 线；`stage → effectState` 用箭头呈现，相同状态合并；审查按钮有文本。
- **Actions**：动作卡片；stage/effect 视觉与 Letters 一致；`CONFIRMED` 只出现一次确认语义，不把 QUEUED/ACK 写成成功。
- **Provider diagnostics**：指标卡网格；大号数值 + 独立单位；`native / estimated / unknown` 用小标签与颜色同时表达；`value:null` 显示“未知”，绝不变成 0；只有提供的 `progress` 才显示进度条。
- **Settings**：行标题 + 右侧控件；`readOnly` 用虚线字段；`select` 的空值显示 `common.unavailable`；help 文本保持；控件只发 `CHANGE_FILTER`。

## 5. 图标

- 统一 24 viewBox、1.7px 圆头线条；行图标 18px、按钮 16px、状态 12px。
- 50 个原创图标，覆盖冻结的 18 个 canonical；额外包含 queued / confirmed / unconfirmed / received / blocked / model / usage / cache / diagnostics / history / filter / sort / calendar / user / users / system 等。
- 不用 emoji、不依赖图标字体、不写全局 sprite id；未知 id 回退 `unknown`，离线且不抛错。
- 语义边界：`check` 只作为动作控件（选择）或已确认状态；ACK 用 inbox/received；来源用 chain/document；未知用问号圆。

## 6. 对话框

- 620–680px 中等宽度；大屏不铺满，保持阅读行宽；小屏底部对齐并接近全宽。
- 头部：42px 圆形 emblem + eyebrow + 标题 + 副标题；右上关闭。
- 内容可滚动，footer 固定；无 actions 时自动提供关闭按钮，避免“只有右上角 X”的悬空收尾。
- 焦点：打开后聚焦面板；Tab 循环限制在 dialog；关闭恢复触发元素；Escape、遮罩、按钮都可关闭（按 `dismissible`）。
- 页面滚动锁只在 dialog 打开时添加 `.v95-dialog-open`；多 dialog 使用计数。
- 只有 UI callback；不把 emit 视作成功，不自动执行审批。

## 7. 动效与切换

- 页面切换：`swapView` 130ms 淡出 / 淡入；不移动宿主布局；reduced-motion 直接切换。
- View 进入：190ms 轻微上移 + 透明度；行只对新加入项播放 190ms。
- 刷新：显示细状态条，不重排已有行；`aria-busy` 只表示正在加载／刷新。
- 对话框：190ms 淡入 + 轻微 scale；关闭 170ms；背景 blur 2px 仅模态层。
- 全部动画都有 `prefers-reduced-motion` 降级。

## 8. 无障碍与阅读

- 语义：`section` + 标题、`list`/`listitem`、`dialog`、`aria-labelledby`/`aria-describedby`、`role=status`。
- 焦点：`:focus-visible` 2px accent outline；dialog 焦点陷阱；`disabled` 控件有 `aria-label` 原因。
- 状态不只靠颜色：图标 + 文本 + 虚线/边框差异。
- 控件有 label／aria-label；CSS 隐藏的 settings label 仍保留关联文本。
- 长文本、2000 字副标题、80 字姓名、无空格路径均通过横向溢出检查。
- 对比：使用 host 的 `--ui-*` 作为文本/表面主色；浅色主题不会把白字放在纸上。

## 9. 明确不做的

- 不新增全局 `body` / `:root` 视觉覆盖；唯一全局类是 `html.v95-dialog-open` 的滚动锁。
- 不把八类页面塞回 `index-Dn3qWlAB.js`，不修改宿主三主题图片。
- 不把 Demo 的合成文案、徽标、状态当作真实业务事实；真实状态由 Codex ViewModel 提供。
- 不在视觉层推导权限、来源或动作效果；不显示“已执行”除非收到 `CONFIRMED`。
- 不新增语言、Provider、Memory、Worldline 业务字段。
