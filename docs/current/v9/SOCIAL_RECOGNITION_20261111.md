# 2026-11-11 对话按需社会认知与当前玩家隔离

本轮在既有人物披露修复上增加政治身份识别和自身伪装。Runtime版本仍为9.7.1，既有Prompt块ID／缓存锚点不变，新增指令进入原动态responder-game-facts。VOTC自身数据导出Mod保持2.0.5／bridge revision 1，新增可选日志行；旧导出没有该行时不授予政治认知。

## 实现行为

- 当前玩家取本次CK3 `GetPlayer`／`GameData.playerID`。A死亡由B继承、主动从A切换到B，均只使用B自己的记录与当前关系；不复制A的知情、披露或手动设置。关于A的历史记录保留。已有亲属规则合法授予的知情不等于迁移认知。
- 初始化只激活玩家和实际入场对象；pinned／候场候选及仅被提及的人物不激活。用户选择候场人物入场时，才激活对应关系。没有全世界认知目录或后台刷新；临时政治认知不写`disclosures-v1.json`。
- CK3只对本次导出候选列表和actor两两输出定向关系依据，不枚举全世界。VOTC依稳定ID、当前玩家和campaign接受依据，按实际选择限定使用。开场快照在本场保留，动作确认回读不刷新政治关系；下一场重新从CK3导出取得依据。
- 定向规则：廷臣→本宫廷领主；所有层级封臣→其王国以上上级；同一高阶领主治下各层级封臣互识；本国领主／封臣／廷臣→陆地相邻国家领主；领地直接陆地接壤的领主互识。邻国关系本身不让双方封臣互识，也不让邻国领主反向认识廷臣。
- 政治识别只放行姓名、头衔、称号和超自然身份。PoD身份按canonical splat ID列明（排除mortal和创建角色标记），另列Wyvern身份；勇敢、贪婪、原版witch、私生子等不因政治关系公开。手动隐藏优先，原五代亲属、配偶及原生knownSecrets规则保留。
- 自身完整特质继续塑造思考、措辞和行为。提示词明确要求所有超自然身份面对不知情者伪装。当前听众是否知道回应者真身按**听众→回应者**读取，纳入认知修订与发送前复核；不会反用回应者对听众的认知。多人场合仍需顾及不知情者。资料投影为确定性边界，具体模型是否遵从扮演指令仍需真实Provider验收。
- 原肯定说明特质的当场披露规则不变：明确人物和真实特质、肯定陈述，全体当时实际在场者获知；候场、暂离不补发，否认／提问／假设不触发。

## 改动范围

Runtime：`social-recognition-policy.js`、`trait-visibility-policy.js`、`trait-profile-selector.js`、`character-disclosure-context.js`、`character-disclosure-store.js`、`conversation.js`、`prompt-builder.js`、`log-parser.js`及认知面板来源标签。新增Runtime映射后共356项。缓存测试fixture补齐实际听众；原来源／Forget拦截断言保持。

游戏侧仅修改VOTC自身`ck3-mod/common/scripted_effects/log_character_v2_effect.txt`，保留UTF-8 BOM，并刷新97文件源码清单。使用原生`is_courtier_of`、`any_liege_or_above`、`highest_held_title_tier`、`top_liege`、`court_owner`和`character_is_land_realm_neighbor`。这些判据在本机CK3脚本中有用例，尚未用真实存档验证新组合的执行结果。

两个独立兼容Mod未参与本轮构建、调度或更新。没有改动它们的源码或安装内容。

## 验证与安装

- 新测试`test-v9.7.2-social-recognition.js`先以缺少实现失败，再通过真实日志解析器及`initializePresence`验证选中范围、同名不同ID、单向授权、普通特质隔离、反向听众认知、手动隐藏、开场冻结、旧init丢弃、错误GetPlayer拒绝及A→B不迁移。
- 21项相关测试串行、每进程384MB通过。清单与日志见本机`.build/social-recognition-20261111/{source-tests,regression-tests,selection-tests}.json`。没有运行大型全量发布门禁或远端CI。
- 独立审查代理另外编写内存对抗fixture，由主代理串行执行通过，覆盖未选目标、入场激活、领主／邻国定向认知、普通特质隔离、混合知情听众、手动隐藏及玩家／战役隔离。源码审查未发现新增确定阻断；该fixture不替代CK3原生邻接判据的实机验证。
- Runtime依赖5981文件／264包校验通过，9个改动模块语法及`git diff --check`通过。356项源码／产物／已安装资源哈希一致，最终payload为`49028de3cbe283e433e0c683b093d842c91617d1aab98443ce1dd2c74b31a624`。部署回执见本机`.build/runtime-deploy-state/receipt.json`，本轮证据汇总为`.build/social-recognition-20261111/delivery.json`。
- VOTC游戏侧97文件源码校验、构建通过。新导出脚本已逐字节核验安装到Workshop `3346777360`，旧文件保存在本机`.build/social-recognition-20261111/ck3-backup/`，安装回执为`ck3-install.json`。
- 安装前核对发现原已安装`common/on_action/votc_load_boundary.txt`比当前源码少一条BRIDGE_HELLO日志，此为既存差异，本轮未改。不能宣称整个已安装Mod的97文件完全一致。
- **真实CK3、真实Provider、应用窗口冒烟、Soak均未执行。** 没有启动／重启／操作应用或游戏，没有新增付费请求，没有推送远端。

## 用户手动验证

由用户在方便时自行重启VOTC和CK3，重新发起对话以取得新日志；已运行的旧脚本和旧对话不能作为新版本验证。

1. 无亲属／无政治关系的初遇者不直接叫出真实身份，吸血鬼／木乃伊／狼人等NPC仍按自身特质行事并保持伪装；先入场的人肯定披露后，实际在场者下一次回复应体现知情，候场／暂离者不得补获。
2. 廷臣知道本领主，但邻国领主不因该关系知道廷臣；多层封臣认识王国以上上级，同一高阶领主治下的不同层级封臣互识身份，而勇敢／贪婪／witch／私生子等仍分别按旧规则。
3. 两邻国的封臣知道对方国家领主；没有直接接壤的两位邻国封臣仍不互识，直接接壤者互识。检查新导出日志是否含`social_recognition`并留意本次启动`error.log`中的作用域／trigger错误。
4. 先让A获知一个与政治／亲属无关的秘密，再切换到无该来源的B或由B继承，重新对话：B不得继承A的认知；B自己既有的记录和当前合法亲属／社会认知应正常生效。
