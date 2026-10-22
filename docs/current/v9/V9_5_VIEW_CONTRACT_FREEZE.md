# V9.5 共享展示契约冻结 · revision 1

2026-10-22，代码基线 main `713e9f614ab233fc3e9d0041cbb93018a54f6886`。本文件是 Codex 给 DeepSeek Harness 的接入说明，冻结 `v95-view-v1` revision 1；不是 V9.5 全部功能或实际 Electron 验收完成声明。

## 权威文件与直接使用

- `src/app/renderer/v95/contracts/view-contract.v1.js`：`CONTRACT_VERSION`、`CONTRACT_REVISION`、`VIEW_KINDS`、`UI_INTENTS`、`ICON_NAMES`、`validateView(view)`、`assertView(view)`、`validateIntent(intent, view)`。
- `src/app/renderer/v95/contracts/async-states.v1.js`：状态、错误码、`normalizeAsyncState(state)`、`errorTextKey(code)`。未知状态归一化为 stale；正式 View 验证不接受未知状态。
- `src/app/renderer/v95/contracts/view-fixtures.v1.js`：`createViewFixtures('zh-CN'|'en-US')` 每种语言40项，八类kind各含ready／empty／loading／error／stale。`createInvalidViewFixtures()` 是应拒绝的负例，不作为合法生产数据渲染。
- `src/app/renderer/v95/i18n/locales/{zh-CN,en-US}.js`：真实字典，各91个叶子键，键与参数完全一致。为直接使用既有本地ES Module加载路线，目录采用.js导出，未引入新编译器或裸包导入。
- `src/app/renderer/v95/i18n/index.js`：Codex将现有已打包i18next实例传入`createUiTranslator(instance, uiLanguage)`，返回`t(key, params)`；视觉侧只接收这个函数，不读写i18next或语言设置。

字典包含common、navigation、conversation、memory、knowledge、worldline、letters、actions、provider、diagnostics、settings、status、errors。未知key、对象或缺失插值一律返回当前语言的common.unavailable，不把原始键、undefined或对象显示给用户。状态、错误值仍是机器代码；未知业务状态用status.UNKNOWN显示，不能写回本地业务文件。

## 模块与样式装载

接受本地ES Module：`export function mountView(container, view, { t, emit, iconRegistry })`，返回`{ update(nextView), destroy() }`。也可由八个领域visual模块分别导出同名入口，再由Codex容器相对import。现有主入口已经通过ESM相对导入world-memory-editor.js；新目录package.json明确type=module，仅作用于v95子目录，不影响旧经典脚本。

视觉模块不新增全局注册，不读window.*API，不写存储、不发网络请求。JS由Codex在主入口／容器相对import，CSS由Codex在index.html显式link；不由DeepSeek修改HTML、主入口、构建清单或out。新正式文件必须由Codex登记runtime-inputs；当前Node模块加载测试通过，完整Electron加载与鼠标焦点门禁在集成后单独验证。

生产主题属性继续为`:root[data-votc-theme="parchment|knight|ink"]`。只在`.v95-ui`根下扩展，桥接现有--ui-*变量；保留背景图片、输入焦点、overlay和点击穿透控制。

## 基础行与可选富字段

通用View字段与源码一致：contractVersion、kind、state、scopeTag、revisionTag、titleKey、rows、emptyTextKey、errorCode、pagination。标签键引用字典；事实文本不自动翻译。rows中的id／scopeTag／revisionTag必须是无路径的opaque UI标识，不是授权令牌，也不是Main Source Key。

基础行是`{id,title,subtitle,dateText,badge,icon,disabled,actions}`；badge为null或`{tone,textKey}`，tone是neutral／info／success／warning／danger。未知icon名称是合法显示边界，图标注册表应离线回退到unknown，不加载外链。重复显示姓名允许，但id必须不同且在当前列表唯一。

以下全部为可选字段，不存在时使用基础行，禁止表现层补造业务事实：

| 字段 | 类型与语义 |
|---|---|
| role | player／npc／system，仅conversation显示身份 |
| text | 已授权的纯文本内容，不是HTML |
| streaming | boolean，仅表示当前显示生成中，不执行生成 |
| timeText | 显示用时间文本，未知可为空 |
| metric | `{value:number|null,unit:string,estimateKind:'native'|'estimated'|'unknown',progress?:number|null}`；progress为0..1，缺用量不能变0 |
| control | `{type:'readOnly'|'select'|'toggle'|'text',value:string|boolean|null,options?:[{value:string,labelKey:string}],helpTextKey?:string}`；只提交CHANGE_FILTER意图，容器决定是否保存 |
| stage／effectState | 原机器状态字符串；用status字典映射，未识别时UNKNOWN，不显示成效果成功 |
| queueTimeText | 显示文本，未知可为空 |

View分页为`{page,pageSize,total}`，page从1起，pageSize不超过200。生产容器先分页再传rows，视觉组件不能为total=50000构造50000个DOM节点。fixture含80字中文姓名、超过2000字正文、2000字无空格字符串、同名不同id、未知时间／来源／图标及50000总数。

## Intent 白名单与二次校验

所有意图都带`{type,viewKind,scopeTag,revisionTag}`；行操作加rowId。行id必须存在，disabled为false，当前View为ready且该行actions包含对应意图，Codex才继续处理。scope／revision不符直接丢弃；表现层不能更新这些标记来获取权限。

- OPEN_DETAIL、OPEN_SOURCE、SELECT_ROW、REQUEST_EDIT、REQUEST_APPROVAL：必须携带rowId。
- CHANGE_PAGE：加`page`正整数，不必带rowId。
- CHANGE_FILTER：加`filterKey:string`、`value:string|boolean|null`；行内控件还带rowId。settings control统一filterKey='value'，由opaque rowId映射到已批准的设置项。不能传完整配置、凭据或任意IPC方法名。
- REQUEST_REFRESH、CANCEL_UI：无行时作用于当前容器。

不接受EXECUTE_ACTION／FORGET_SOURCE／RETRY_EFFECT或附带函数。REQUEST_APPROVAL仅请求既有容器打开审查／确认；视觉层不能把emit完成当作后端成功，不能二次执行或自动重发。emit返回值不属于v1合同。

## 验证与所有权

`test-v9.5-view-contract.js`已串行通过80项双语kind／状态夹具、91键及插值一致性、真实已安装i18next的缺失回退、旧scope／revision意图、未知状态、重复key、私有字段和非法动作反例。`test-v9.5-language-settings.js`的Main设置隔离专项通过；测试清单已登记。此时只冻结共享接口，不宣称八域生产容器已接入。

DeepSeek维护visual/**、icons/**及自己的review/v95-deepseek交付材料；Codex不覆盖其COORDINATION.md。本文件与contracts／i18n为Codex权威。兼容新增字段须修订说明；破坏性变更必须双方重新核验。DeepSeek可按本revision施工，交付后Codex继续完成安全审查、真实接线和发布Gate。
