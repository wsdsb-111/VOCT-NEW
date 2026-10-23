# V9.5.1 实施与验证

日期：2026-10-23。施工基线 d72b07d8f04fc10a90e538f84b9e5e3ae43396f4；Core/App/UI 9.5.1，保持 Workshop 2.0.5、协议3.0、Legacy存储2.5和Official Action 2.0.3。

## 实施

- 原页面增量接入审核过的离线图标／状态组件，原控件与业务容器保留；无重复工作区、通用DOM扫描或额外数据请求。详见[页面矩阵](V9_5_1_PAGE_MIGRATION_MATRIX.md)。
- 顶部 optimization/worldbook 各有独立离线SVG，原点击目标及顺序保持；三主题、双语、实际导航DOM通过。
- 官方追忆 reader 在前后复核 Main context，绑定回应者、对话、战役、Owner、epoch和快照事件；latest/cancel/dispose/15秒超时不重放。空对话事件同步失效，避免重置事件间隙露旧正文；普通stream更新不清context。Main来源授权和原文不改。
- 178个连接设置/Summary/Letters键及复杂结果描述符接入当前UI语言，Provider/Worldline固定诊断标签补双语；正文、姓名、ID、Prompt、用户草稿及诊断值不翻译。[双语矩阵](V9_5_1_I18N_COVERAGE.md)列实际覆盖与正文边界。
- ConfigPanel监听窗口resize，在渲染时钳制尺寸和位置，保持原drag/resize handlers。1280×720、1024×576、853×480无横向溢出，关闭按钮可聚焦；该模拟不等于真实Windows DPI验收。

- 追加用户实测修复：连接 Schema 传输和 GLM 选项、最终摘要 Token 设置有独立双语键；GLM 去除前端品牌前缀。`actions:getAll` 只读 DTO 新增已有定义的中英标题，保留旧 `title` 和动作语言；UI 只选择显示标题，不触发动作或改写模组。关键动作召回面板移除，后台历史数据与按请求类型 action 统计保留。

## 自动验证状态

- 官方追忆专项覆盖中英原文×中英UI、回应者/上下文/快照/逆序/超时/拒绝/卸载；生产runtime事件桥另有真实reader fixture，均PASS。
- 页面接线、178键及双语结果、实际浏览器8页/三主题/双语/小视口专项PASS。基线与当前源码的匿名before/after各8页见review/v951，截图仅为合成UI证据，不是游戏事实。
- build/verify/deploy/verify --deployed：346项通过；最终 Payload `e8f135cfae5df534086d379eeb286caa65b1de90ef4e52ea5e1fe0136ac7329d`，备份回执 `17921eae-ec2e-4c00-ad2d-0df92c0f78c7`。与下述成功CI的 Runtime Payload 一致。
- 完整本机Manifest收集停于第121组进度，未生成完成结果（INCOMPLETE）；已出现本机Windows链接/部署夹具检查失败，不冒充全量PASS。标准完整发布门禁交精确SHA的Windows CI另验。
- 本机隔离完整分发副本EXE：FAILED，调试端点建立前退出2147483651（0x80000003），stdout仅换行，stderr为空；未证明原因，不用后续远端PASS覆盖本机失败。证据在.build/v9.5.1-local-exe.log及该日志指向的evidence.json。
- Canon 历史保存专项首次在受限执行中因无法建立分支写入夹具失败；同一断言在允许 Windows 文件原子写入的执行环境串行重跑 PASS，没有修改 Canon 服务或降低拒写断言。Action 配置、overlay、GLM Provider、三主题背景及最终178键双语专项均 PASS，未访问真实端点。

复现命令：`node scripts/test-v9.5.1-{official-recollection-scope,page-integration,i18n-coverage,nav-icons}.js`（四个脚本分别执行），`node scripts/test-v9.5-renderer-runtime.js`、`node scripts/test-v9.5-legacy-i18n.js`、`node scripts/test-v9.5-canon-state-context.js`。浏览器专项加 `--capture-page-snapshots` 可基于 HEAD 生成匿名前后8页截图；本次截图基线为施工前 d72b07d，证据在 `review/v951/{before,after}`。小视口模拟不等同真实Windows DPI与鼠标穿透验收。

## 远端发布门禁

最终代码 `bcdf226be1e01288dcc7383718b96cd74594d2bf` 的 [Windows CI 39944550467](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39944550467) **PASS**：505组完整发布回归、346项构建／部署哈希校验、完整6399文件分发副本的 EXE 冷启动／同 profile 重启／三主题媒体加载通过。清单输出633个测试文件已分类、127项历史检查归档；这是自动化合成环境的结果，真实CK3／Provider／手动输入与Soak仍独立未验收。

代码 `2ae3ee300c1cb451500f636ad83073fb30ddd057` 的 [CI 39936362209](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39936362209) 首轮 FAILED：新增导航测试用 `innerText` 精确比较摘要标题，骑士主题的 CSS uppercase 把 Token 显示为 TOKEN，触发文案断言；原始 DOM 文案和实际双语接线正确。测试改用 `textContent` 检验原文，不改 CSS 或弱化图标、焦点和小视口断言，本机默认入口路径重跑 PASS。该失败保留；同轮完整 EXE 冷启动／重启／媒体检查 PASS，但不抵消 release regression 的失败。最终精确代码的完整门禁另记。

测试修正提交 `70e7c9e627a9064e7063ee301dbeaaaefe91bd75` 的 [CI 39938529633](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39938529633) 第二轮 FAILED 于旧 `v8.4-luna-worldline-ui`：旧断言仍要求官方追忆走直接 invoke，而本版已按规格移至 scoped reader。更新为更小的直接调用白名单，并新增禁止绕过 reader、按钮 refresh 及同步 getStateFor 投影的接线断言，本机专项 PASS；Main 权限与其他白名单检查保持。同轮完整 EXE 检查 PASS。

`a9612edb15143047e23e0f7e294629bf589eaa26` 的 [CI 39940920563](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39940920563) 第三轮 FAILED 于旧单篇摘要绑定测试仍在 bundle 查找已迁入字典的中文确认文案。改为同时核对实际确认调用及中英词条；同类日期重同步旧标签断言一并核对字典与按钮调用。单篇／批量绑定和 Letter 日期／载荷／Effect／恢复专项本机串行 PASS，业务安全断言未删。同轮完整 EXE 检查 PASS。独立静态审查未发现追加英文标题、GLM、Schema 和统计面板改动的 P0/P1 问题；该审查不替代运行验收。

同一最终代码此前的 [CI 39943721309](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/39943721309) FAILED 于 `v9.5-visual-lifecycle` 的 Chrome 调试端点启动超时，用例尚未开始；没有证明业务或运行环境的具体原因。保持源代码与断言不变，仅重跑一次隔离CI，得到上面的505组 PASS，原失败不删除。同轮完整 EXE 检查也 PASS。

## 资源与剩余Gate

用户先允许提高负载，随后明确另一项目正在运行；本机改为一次一个测试进程、384MB Node 堆，浏览器单实例，不再本机重跑大型收集或完整分发复制。此前768MB／最多两项仅代表早先执行条件。EXE启动前可用物理内存实测约2458MiB；未无限并发测试或修改系统安全策略。

真实CK3、真实Provider、本机手动输入与透明区域穿透、真实125%/150%DPI、长时间Soak仍NOT_RUN；无新增付费请求。保持候选，不宣称Full Freeze。

## 回滚

运行资源备份保存在.build/runtime-deploy-state/backups，部署回执与恢复沿既有脚本；只回滚匹配的应用资源，保留用户设置、摘要、信件队列、CK3存档和来源记录。新增映射由同一部署收据管理，不手改out。
