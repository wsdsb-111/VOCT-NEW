# V9.5 DeepSeek 交付审查

2026-10-23，Review Result: **ACCEPT（代码接入）**。这不代表真实 CK3 或本机 EXE 输入验收。

交付以 `review/v95-deepseek/MANIFEST.json`、`HANDOFF.md` 和 `INTEGRATION_REQUESTS.md` 为据，基线为 `713e9f6`，共享合同 `v95-view-v1` revision 1。收到的是工作目录文件与源码包，没有待应用的 Git patch；逐文件检查实际目录与冻结合同后接线，未整文件覆盖旧主入口。

19 个生产文件限于 `v95/visual` 和 `v95/icons`。检查未发现 IPC、用户存储、fetch、eval、innerHTML、远程字体或图标依赖。八种 mount/update/destroy 表现模块通过安全投影消费数据；详情使用文本节点，危险操作不接入表现层。

Codex 审查并修复：

| 问题 | 处理与证据 |
|---|---|
| 模态窗口反向 Tab 或外部程序化聚焦可逃逸 | document capture + topmost 焦点约束，关闭时退订；生命周期专项通过 |
| 行操作重建丢失焦点 | 优先同操作，再剩余操作，最后行容器；草稿输入保留 |
| 重叠过渡或已卸载宿主仍运行旧 render | WeakMap 宿主序号与连接检查；快速切换专项通过 |

Codex 在 `v95/integration.css` 中调整三主题阅读遮罩、暖纸与深金配色、按钮选中/焦点/按压反馈及 150ms 过渡，保留原背景图片，支持 reduced-motion。通用详情组件支持挂载到 body；独立工作区已按用户反馈移除，未新增第二套业务入口。现有导航使用离线 SVG 图标，大面板取消额外底色／阴影，主题阅读遮罩降至 18–30%，头部 22%。

Root 独立重跑交付测试 **22/22 PASS**、生命周期 **3/3 PASS**；移除工作区后，实际 `src/app/renderer/index.html` 在匿名 Preload 的单个 Chrome 中通过原设置页、三主题、双语、焦点、透明背景、保留主题图片和无副作用检查。八域通用组件的 fixture 检查不代表全部旧页面已迁移。交付截图和这组浏览器证据均不能代替 EXE、Windows DPI、用户鼠标穿透或真实 CK3 验收。原交付大图与源码压缩包保留本地；仓库保存审查说明和可复验脚本。
