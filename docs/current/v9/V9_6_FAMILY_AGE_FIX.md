# V9.6 当前公开近亲年龄遮盖修复

日期：2026-10-25。保持 Core／App／UI 9.6.0 候选及既有 Bridge／Mod 版本；本补丁没有修改 Prompt block ID、cache anchor、导出格式或 Workshop 文件。

## 证据与原因

用户报告四兄妹对话把大姐叫作二姐、二哥叫作三哥。经授权只读检查对应已保存对话及 CK3 日志，确认存在这些错误称呼；原始资料中四人的当前年龄为 14／8／6／5，来源均为 `CK3_CURRENT_AGE`，各对均被现有 `isPublicCloseFamily` 认定为当前公开近亲。逐回应者运行生产投影函数时，本人年龄保留，另外三人的年龄全部变为 null。

根因在 `prompts/trait-profile-selector.js`：姓名、头衔和特质已有公开近亲豁免，年龄却只接受定向 `AGE` disclosure。近亲即使已被确认，年龄及出生字段仍被清除。旧版脱敏前的逐对长幼推导仍存在，但不能代替标准人物资料、脚本与自定义模板中的年龄字段；原生资料未错序，问题出在 Prompt 投影。

## 修复边界

- 年龄投影复用现有 `isPublicCloseFamily`；当前公开父母子女、亲兄弟姐妹（含符合既有证明条件的公开半亲）保留已有年龄及出生字段。缺失资料不补造，源对象不修改。
- 近亲 Prompt 白名单说明同步加入“年龄”。不扩大秘密、历史记忆、第三人召回、继亲或未公开血缘的权限；陌生人与无效来源继续遮盖。
- 独立 QA 发现家庭事实的另一条年龄推导可借未经同等校验的兄妹边生成称谓。`character-family-facts.js` 在 SIBLING_OF 长幼比较前复用相同的当前公开近亲校验；陈旧／跨 Campaign／来源所有者错配／STEP 不可绕过。叔伯仍与关系路径上的父亲或母亲比较，不改为与孩子比较。
- 不增加全家族数字排行算法，不用在场名单或 Runtime ID 猜测次序；保留既有逐对长幼与双向称谓。
- 原始游戏日志、对话、摘要与已投递命令保持原样。旧对话中的错误称呼没有被自动改写，真实模型输出仍需重新发起对话复测。

## 验证

修复前，新增独立 QA 在“公开兄妹年龄应保留”处稳定失败；修复后投影与实际 V813 Prompt 路径通过。新增组 `test-v9.6-family-age-independent-qa.js` 已登记到发布清单，覆盖四个回应者、姓名与年龄／出生字段、陌生人、合法 AGE disclosure、过期／跨 Campaign／错 owner／STEP、未公开私生亲属、源对象不变及陈旧关系不得输出长幼称谓。

本机低负载串行通过 8 项：独立 QA、pre-redaction kinship、family whitelist、disclosure store、trait access、trait profile routing、kinship source QA、age-family Prompt。旧测试中“近亲数字年龄也遮盖”的断言按本次明确合同改成保留年龄；叔伯正例补齐当前来源证明，手工投影夹具同时遮盖嵌套亲属年龄，负例与原有来源断言保留。独立只读复审通过。

排查时误运行已归档的 `test-v8.15.2-provider-visible-traits.js`，它因依赖已退役 Memory4 的 `buildOwnerSnapshot` 失败；该失败不是当前发布组，不恢复退役链路，当前披露及 trait 路由替代组已通过。临时文件原子重命名曾受沙箱限制，取得相应权限后当前专项通过。

Runtime 已按源构建／验证／部署流程更新，352 项资源；部署前因 VOTC 运行触发保护，用户明确退出后才替换资源。部署后使用同一真实 CK3 日志逐回应者离线回放，4×4 共 16 个年龄投影均与原资料相同，当前公开近亲关系均成立。Payload 为 `ca9663ad346704ac85d3de5426d122c1b4af266a81aae1e4a2ce1335f20b0b47`。

没有新增 Provider 请求，没有修改真实用户数据。完整发布清单现为 510 组，准确代码 SHA 的 Windows CI 在通过后补记。真实模型称谓、游戏内新对话与 Soak 尚未验收。
