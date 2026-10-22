# V9.5.0 候选发布验证

更新日期：2026-10-23。Core/App/UI **9.5.0** 候选；Workshop 2.0.5、Official Action 2.0.3、协议 3.0 和摘要存储 2.5 保持。

## 当前修正验证

工作区移除已推送 `31037d9`，本轮另补齐头部旧渐变清除。本机 build、verify、deploy 和 deployed parity 通过：343 项映射，Payload SHA256 `d2d28139fe24ec47fe40cac2e0b059f31a91c6e1e416ab424783a8c8a6958430`。原功能页的三主题／双语、透明底色、保留主题图片、焦点和零业务副作用通过单 Chrome 匿名 Preload 冒烟；完整历史原文的 Canon 保存／回读与当前状态反例通过。旧 knowledge-ui 断言已按实际 `t` 与 `updateLanguage` 接线修正并本地通过，原安全／作用域断言保留。本轮提交的完整 Windows CI 等待中。

## 前次 CI 与历史证据

用户确认原有功能页已满足需求，并反馈重复的“V9.5 工作区”白色大面板遮住主题背景。Root 已移除独立工作区 UI 和其专用接线，通用契约及共享展示组件保留；视觉改动回到原功能页面，同时降低大面板遮罩不透明度。旧功能页面尚未全面迁移。

前次 SHA `ff86656` 的 [CI run 39822389302](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39822389302) 在旧 `knowledge-ui` 源码断言处停止，该 SHA 的全量发布门禁为 **FAILED**；该运行未完成后续全量检查。该断言已修正并在本地通过；失败记录仅属于旧 SHA。最新提交 的完整 CI 等待中，不预写结果。

已有 EXE 检查成功，但对应 Payload SHA256 `1a800b12bda2e750174a7bdf0452d0dd0451cf351ca5637a50655f364958e3c2` 属于移除工作区之前的旧批次。它保留为历史 EXE 证据，不代表当前移除工作区后的代码或资源。

## 移除前旧批次记录

以下结果对应包含八域工作区的先前候选，保留历史证据，不作为当前 Gate：

- 开发基线 `713e9f614ab233fc3e9d0041cbb93018a54f6886`；runtime-dependencies、build、verify、deploy、verify --deployed 当时通过，报告 346 项映射。Payload 为上述 `1a800b12...e3c2`，部署替换 55 项，原资源备份保存在 `.build/runtime-deploy-state/backups`；未清理用户数据。该 Payload 现已过期。
- 首次沙箱构建的原子重命名曾遇到 EPERM；获准以相同命令重试后成功。部署保护发现后台 VOTC；用户退出并同意后，仅结束路径核实的本安装进程再部署，未绕过关闭保护。该记录是旧批次操作证据。
- DeepSeek 交付与生命周期审查记录为 22/22、3/3 PASS；`V9_5_DEEPSEEK_REVIEW.md` 保留原审查结论。工作区已移除，不把该视觉交付结果当成当前功能或发布通过。
- 移除前的八域／三主题／双语 Chrome 冒烟、双语与异步专项、Provider／容器专项均仅为各自旧源码范围内的历史结果；详见[异步与双语验证记录](V9_5_ASYNC_I18N_VERIFICATION.md)。
- 旧批次曾在临时合成战役中进行 Canon 保存与回读。该结果早于目前收紧的事件延续豁免，不能覆盖姓氏“曾”、跨人物断言等新增反例；最新状态分类及完整原文回归已串行通过，见上方当前证据。未连接真实战役或修改真实记忆。

## 当前验收门

| Gate | 当前状态 |
|---|---|
| 前次 SHA `ff86656` 的完整 Windows CI | **FAILED**：run 39822389302 在过时的 `knowledge-ui` 源码断言处停止；该失败属于旧 SHA，断言已本地修正并通过。 |
| 当前 SHA 本轮提交的完整 Windows CI | 等待中；不预写结果。 |
| 当前 SHA 的 build/deploy、343 项映射及 Payload | PASS：`d2d28139fe24ec47fe40cac2e0b059f31a91c6e1e416ab424783a8c8a6958430`。 |
| 当前源码 EXE 冷启动／重启／媒体和界面冒烟 | 未验证；此前 EXE 检查对应旧 Payload。 |
| 历史世界记忆当前状态边界回归 | PASS：完整用户原文在临时合成战役保存并回读，当前人物状态反例仍受保护。 |
| 真实 CK3、真实 Provider、新增外部效果、长时间 Soak | NOT_RUN。 |
| 同机性能 A/B | **NOT_MEASURED**；没有可比基线。 |

V9.5.0 仍是候选。前次完整 CI 的失败仍归属于 `ff86656`；最新本机专项与构建不代替 本轮完整 CI，未完成该 Gate 前不宣称发布完成或 Full Freeze。
