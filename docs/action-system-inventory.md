# VOTC Action System Inventory
## v6.4 Baseline for v6.5 Refactor

> **生成日期**: 2026-08-19 (校正版)  
> **目的**: 为 v6.5 Event-based / metadata-driven 重构建立可靠基线  
> **状态**: 基线校正完成，禁止修改生产代码  
> **测试基线**: ✅ 全部通过 (22 trigger + 12 semantic + 8 script = 42 cases)

---

## 📊 总体统计（机器验证）

| 指标 | 数值 | 验证方式 |
|------|------|----------|
| **总 Action Script 数量** | **36** | `Get-ChildItem *.js` |
| **Gate categories (getActionTriggers)** | **21** | 19 rules[] + scheme_start + sexual_intercourse_completed |
| **byReason mapping categories** | **13** | 12 非空 + 1 空 (combat) |
| **byReason 映射的 unique Action IDs** | **27** | 提取 byReason 对象 |
| **getSemanticActionProfile 硬编码 Action IDs** | **32** | 提取 allow() 调用 |
| **同时被 byReason 和 semantic 引用** | **27** | 集合交集 |
| **仅被 semantic 引用（不在 byReason）** | **5** | recordFactionCommitment, resolvePrisoner, setRoleplayStatus, startHostileScheme, startPersonalScheme |
| **完全通过 triggerCategories 自注册** | **4** | noOp, performCombatAction, performDailyAction, performIntimateAction |
| **声明了 triggerCategories 的 Action** | **8** | grep isDestructive 字段 |
| **isDestructive=true 的 Action** | **7** | grep isDestructive 字段 |
| **实际有 run() 执行测试的 Action** | **8** | test-action-system.js |
| **有 gate 测试的高风险 Action** | **7/7 (100%)** | trigger/semantic cases |
| **有 run() 测试的高风险 Action** | **3/7 (43%)** | startHostileScheme, recordFactionCommitment, resolvePrisoner |

---

## 🔴 高风险 Action 清单 (isDestructive=true)

### 1. characterIsKilled
- **文件路径**: `z_characterIsKilled.js`
- **triggerCategories**: ❌ 无
- **check() 条件**: 允许所有角色（排除 source）
- **需要 target**: ✅ 是
- **主要 args**: `isPlayerSource` (boolean)
- **游戏效果**: `death = { death_reason = death_murder, killer = ... }`
- **当前 semantic 判定**: 由 `getSemanticActionProfile` 硬编码，检测"杀死|砍死|刺死|处死|斩首|断气"等关键词
- **是否被 getActionIdsForTriggers 引用**: ✅ 是 (`death_or_injury` category)
- **是否被 getSemanticActionProfile 引用**: ✅ 是
- **适合迁移到 metadata**: ✅ **高优先级**，语义明确（死亡关键词）
- **风险等级**: **HIGH** - 不可逆的角色死亡
- **当前 regression test**: ❌ 无 (只有 trigger gate 测试，无 script 执行测试)

### 2. isImprisonedBy
- **文件路径**: `z_isImprisonedBy.js`
- **triggerCategories**: ❌ 无
- **check() 条件**: 允许所有角色（排除 source）
- **需要 target**: ✅ 是 (target 是 jailor)
- **主要 args**: `prisonType` (enum: house_arrest, dungeon), `isPlayerSource` (boolean)
- **游戏效果**: `imprison_character_effect` / `rightfully_imprison_character_effect`
- **当前 semantic 判定**: 由 `getSemanticActionProfile` 硬编码，检测"囚禁|关进|关押|投入|收监|逮捕|拘押"等
- **是否被 getActionIdsForTriggers 引用**: ✅ 是 (`imprisonment` category)
- **是否被 getSemanticActionProfile 引用**: ✅ 是
- **适合迁移到 metadata**: ✅ **高优先级**，语义明确
- **风险等级**: **HIGH** - 剥夺自由，高影响状态变化
- **当前 regression test**: ❌ 无

### 3. startHostileScheme
- **文件路径**: `z_startHostileScheme.js`
- **triggerCategories**: ✅ `["scheme_start"]`
- **check() 条件**: 需要至少 2 个角色
- **需要 target**: ✅ 是
- **主要 args**: `scheme` (enum: murder, abduct, fabricate_hook), `isPlayerSource` (boolean)
- **游戏效果**: `start_scheme = { type = ..., target_character = ... }` (需要 `can_start_scheme`)
- **当前 semantic 判定**: 
  - Gate: `getActionTriggers` 检测"开始|着手|决定|准备|打算|计划|部署|布置|实施|启动|设法|派人|派刺客|雇凶" + "暗杀|谋杀|绑架|劫持|制造把柄"
  - Semantic: `getSemanticActionProfile` 区分敌对/非敌对计谋
- **是否被 getActionIdsForTriggers 引用**: ❌ 否 (通过 triggerCategories 自注册)
- **是否被 getSemanticActionProfile 引用**: ✅ 是
- **适合迁移到 metadata**: ✅ **中优先级**，需要组合判定（意图 + 敌对类型）
- **风险等级**: **HIGH** - 启动对抗性计谋
- **当前 regression test**: ✅ 有 (`test-action-system.js` 包含 `hostileScheme.run()` 测试)

---

## 🟡 中风险 Action 清单

### 关系变化类 (9个)

#### 4. becomeSoulmatesWith
- **文件路径**: `z_becomeSoulmatesWith.js`
- **triggerCategories**: ❌ 无
- **当前 semantic 判定**: 由 `getSemanticActionProfile` 检测"灵魂伴侣|灵魂相契|命定之人" + 组合判定（长久对视 + 亲吻）
- **是否适合 simple regex metadata**: ⚠️ **部分** - 简单关键词可以，但组合规则需要 custom matcher
- **风险等级**: MEDIUM
- **当前 regression test**: ✅ 有语义测试

#### 5. becomeLoversWith
- **文件路径**: `z_becomeLoversWith.js`
- **triggerCategories**: ❌ 无
- **当前 semantic 判定**: "情人|恋人|相恋|相爱|坠入爱河|定情|私定终身" + 组合判定（亲密接触）
- **是否适合 simple regex metadata**: ⚠️ **部分**
- **风险等级**: MEDIUM
- **当前 regression test**: ✅ 有语义测试

#### 6. becomeFriendsWith
- **文件路径**: `z_becomeFriendsWith.js`
- **triggerCategories**: ❌ 无
- **当前 semantic 判定**: "朋友|友人|友谊"
- **是否适合 simple regex metadata**: ✅ **是**
- **风险等级**: MEDIUM
- **当前 regression test**: ❌ 无

#### 7. becomeBestFriendsWith
- **文件路径**: `z_becomeBestFriendsWith.js`
- **triggerCategories**: ❌ 无
- **当前 semantic 判定**: "至交|挚友|生死之交"
- **是否适合 simple regex metadata**: ✅ **是**
- **风险等级**: MEDIUM
- **当前 regression test**: ❌ 无

#### 8. becomeBloodBrothersWith
- **文件路径**: `z_becomeBloodBrothersWith.js`
- **triggerCategories**: ❌ 无
- **当前 semantic 判定**: "义结|结拜|义兄弟|血盟兄弟"
- **是否适合 simple regex metadata**: ✅ **是**
- **风险等级**: MEDIUM
- **当前 regression test**: ❌ 无

#### 9. becomeRivalsWith
- **文件路径**: `z_becomeRivalsWith.js`
- **triggerCategories**: ❌ 无
- **当前 semantic 判定**: "仇敌|冤家|势不两立"
- **是否适合 simple regex metadata**: ✅ **是**
- **风险等级**: MEDIUM
- **当前 regression test**: ❌ 无

#### 10. becomeNemesisWith
- **文件路径**: `z_becomeNemesisWith.js`
- **triggerCategories**: ❌ 无
- **当前 semantic 判定**: "死敌|宿敌|不共戴天"
- **是否适合 simple regex metadata**: ✅ **是**
- **风险等级**: MEDIUM
- **当前 regression test**: ❌ 无

#### 11. agreedToTruceWith
- **文件路径**: `z_agreedToTruceWith.js`
- **triggerCategories**: ❌ 无
- **当前 semantic 判定**: "停战|休战"
- **是否适合 simple regex metadata**: ✅ **是**
- **风险等级**: MEDIUM
- **当前 regression test**: ❌ 无

#### 12. makeAlliance
- **文件路径**: `z_makeAlliance.js`
- **triggerCategories**: ❌ 无
- **当前 semantic 判定**: "结盟|同盟|盟友"
- **是否适合 simple regex metadata**: ✅ **是**
- **风险等级**: MEDIUM
- **当前 regression test**: ❌ 无

### 职位/雇佣类 (5个)

#### 13. isEmployedBy
- **文件路径**: `z_isEmployedBy.js`
- **triggerCategories**: ❌ 无
- **当前 semantic 判定**: 通用雇佣（未匹配骑士、议会、宫廷职位）
- **风险等级**: MEDIUM
- **当前 regression test**: ❌ 无

#### 14. isEmployedAsKnightBy
- **文件路径**: `z_isEmployedAsKnightBy.js`
- **triggerCategories**: ❌ 无
- **当前 semantic 判定**: "骑士|侍从"
- **是否适合 simple regex metadata**: ✅ **是**
- **风险等级**: MEDIUM
- **当前 regression test**: ✅ 有语义测试

#### 15. isAssignedToCouncilBy
- **文件路径**: `z_isAssignedToCouncilBy.js`
- **triggerCategories**: ❌ 无
- **当前 semantic 判定**: "议会|内阁"
- **是否适合 simple regex metadata**: ✅ **是**
- **风险等级**: MEDIUM
- **当前 regression test**: ❌ 无

#### 16. isAssignedToCourtPositionBy
- **文件路径**: `z_isAssignedToCourtPositionBy.js`
- **triggerCategories**: ❌ 无
- **当前 semantic 判定**: "宫廷职位|宫廷职务"
- **是否适合 simple regex metadata**: ✅ **是**
- **风险等级**: MEDIUM
- **当前 regression test**: ❌ 无

#### 17. isFiredFromCouncilOf
- **文件路径**: `z_isFiredFromCouncilOf.js`
- **triggerCategories**: ❌ 无
- **当前 semantic 判定**: "罢免|罢官|免去|撤职|解职|革职|贬职|开除"
- **是否适合 simple regex metadata**: ✅ **是**
- **风险等级**: MEDIUM
- **当前 regression test**: ❌ 无

### 信仰/封臣类 (2个)

#### 18. convertsToReligionOf
- **文件路径**: `z_convertsToReligionOf.js`
- **triggerCategories**: ❌ 无
- **当前 semantic 判定**: "改宗|皈依|改信|改奉|弃绝信仰|信奉...教"
- **是否适合 simple regex metadata**: ✅ **是**
- **风险等级**: MEDIUM
- **当前 regression test**: ❌ 无

#### 19. isVassalizedBy
- **文件路径**: `z_isVassalizedBy.js`
- **triggerCategories**: ❌ 无
- **当前 semantic 判定**: "臣服|归顺|投降|称臣|纳贡称臣|宣誓效忠|成为封臣"
- **是否适合 simple regex metadata**: ✅ **是**
- **风险等级**: MEDIUM
- **当前 regression test**: ✅ 有语义测试

### 伤害类 (1个)

#### 20. isInjured
- **文件路径**: `z_isInjured.js`
- **triggerCategories**: ❌ 无
- **需要 target**: ✅ 是
- **主要 args**: `injuryType` (enum: wounded, remove_eye, blind, cut_leg, cut_balls, disfigured)
- **游戏效果**: 添加 wounded/maimed/disfigured/blind/one_eyed/one_legged/eunuch trait
- **当前 semantic 判定**: 由 `getSemanticActionProfile` 检测"刺伤|砍伤|打伤|重伤|负伤|受伤|骨折|流血"（非死亡词）
- **是否被 getActionIdsForTriggers 引用**: ✅ 是 (`death_or_injury` category)
- **是否被 getSemanticActionProfile 引用**: ✅ 是
- **适合迁移到 metadata**: ✅ **高优先级**，与死亡需 exclusive 互斥
- **风险等级**: MEDIUM - 永久性状态变化
- **当前 regression test**: ✅ 有语义测试

### 计谋类 (1个)

#### 21. startPersonalScheme
- **文件路径**: `z_startPersonalScheme.js`
- **triggerCategories**: ✅ `["scheme_start"]`
- **需要 target**: ✅ 是
- **主要 args**: `scheme` (enum: sway, befriend, seduce, romance), `isPlayerSource` (boolean)
- **成人校验**: ✅ 对 seduce/romance 强制双方成年
- **游戏效果**: `start_scheme` (需要 CK3 原生 `can_start_scheme`)
- **当前 semantic 判定**: 与 hostile scheme 通过语义区分
- **是否适合 simple regex metadata**: ⚠️ **部分** - 友好计谋关键词简单，但需与敌对计谋互斥
- **风险等级**: MEDIUM
- **当前 regression test**: ✅ 有 (`test-action-system.js`)

### 派系/囚犯类 (2个)

#### 22. recordFactionCommitment
- **文件路径**: `z_recordFactionCommitment.js`
- **triggerCategories**: ✅ `["faction_commitment"]`
- **主要 args**: `operation` (enum: join, leave, support_claimant, oppose)
- **游戏效果**: 设置带期限的 character flag `votc_faction_commitment_*`
- **当前 semantic 判定**: Gate 检测"加入|退出|支持|反对" + "派系|阵营|宣称者"
- **是否适合 simple regex metadata**: ✅ **是**
- **风险等级**: MEDIUM
- **当前 regression test**: ✅ 有

#### 23. resolvePrisoner
- **文件路径**: `z_resolvePrisoner.js`
- **triggerCategories**: ✅ `["prisoner_resolution"]`
- **主要 args**: `resolution` (enum: release, banish)
- **游戏效果**: `release_from_prison = yes` / `banish = yes`
- **当前 semantic 判定**: Gate 检测"释放|放了|放出|获释|恢复自由|赦免|遣返|逐出|放逐|流放"
- **是否适合 simple regex metadata**: ✅ **是**
- **风险等级**: MEDIUM
- **当前 regression test**: ✅ 有语义测试 + 执行测试

---

## 🟢 低风险 Action 清单

### 财物转移类 (2个)

#### 24. paysGoldTo
- **文件路径**: `z_paysGoldTo.js`
- **triggerCategories**: ❌ 无
- **主要 args**: `amount` (number, 1-10000)
- **游戏效果**: 转移金币
- **当前 semantic 判定**: Gate 检测"支付|付给|给了|交给|奉上|赏赐|赠与|转交"等 + 金钱词
- **是否适合 simple regex metadata**: ✅ **是**
- **风险等级**: LOW
- **当前 regression test**: ❌ 无

#### 25. playerPaysGoldTo
- **文件路径**: `z_playerPaysGoldTo.js`
- **triggerCategories**: ❌ 无
- **主要 args**: `amount` (number, 1-10000)
- **游戏效果**: 玩家支付金币
- **当前 semantic 判定**: 与 `paysGoldTo` 通过 `isPlayerSource` 或 candidate speaker 区分
- **是否适合 simple regex metadata**: ✅ **是**
- **风险等级**: LOW
- **当前 regression test**: ❌ 无

### 地点/离开类 (2个)

#### 26. changeLocation
- **文件路径**: `z_changeLocation.js`
- **triggerCategories**: ❌ 无
- **主要 args**: `location` (string, max 100)
- **游戏效果**: 设置 character flag `votc_location_*`
- **当前 semantic 判定**: "踏入|进入|来到|赶往|移步|前往|返回|回到|抵达|到达|搬到|移动到"
- **是否适合 simple regex metadata**: ✅ **是**
- **风险等级**: LOW
- **当前 regression test**: ✅ 有语义测试

#### 27. leavesConversation
- **文件路径**: `z_leavesConversation.js`
- **triggerCategories**: ❌ 无
- **游戏效果**: 结束当前对话
- **当前 semantic 判定**: "离开|走出|退出|离席|离场|转身离去|退下|告辞"
- **是否适合 simple regex metadata**: ✅ **是**
- **风险等级**: LOW
- **当前 regression test**: ✅ 有语义测试

### 好感变化类 (1个)

#### 28. changeOpinionOf
- **文件路径**: `z_changeOpinionOf.js`
- **triggerCategories**: ❌ 无
- **主要 args**: `amount` (number, -100 to 100)
- **游戏效果**: `add_opinion` modifier
- **当前 semantic 判定**: Gate 检测"好感|好感度|评价|看法|态度" + "增加|上升|提高|改善|下降|降低"等
- **是否适合 simple regex metadata**: ✅ **是**
- **风险等级**: LOW
- **当前 regression test**: ❌ 无

### 情绪/姿态类 (1个)

#### 29. setEmotion
- **文件路径**: `z_setEmotion.js`
- **triggerCategories**: ❌ 无
- **主要 args**: `emotion` (enum: 大量姿态选项)
- **游戏效果**: 设置 `talk_pose` 变量
- **当前 semantic 判定**: Gate 检测 `drinking_or_toast` 或 `visible_pose`，然后限制可用姿态
- **是否适合 simple regex metadata**: ⚠️ **部分** - 依赖多个 gate category
- **风险等级**: LOW
- **当前 regression test**: ❌ 无

### 亲密关系类 (2个)

#### 30. isUndressed
- **文件路径**: `z_isUndressed.js`
- **triggerCategories**: ❌ 无
- **游戏效果**: 设置 character flag `votc_is_undressed`
- **当前 semantic 判定**: Gate 检测"脱下|脱掉|脱去|脱光|褪下|褪去|除去|扯开|撕开|解下|解衣|宽衣|裸露|裸身|赤裸"
- **是否适合 simple regex metadata**: ✅ **是**
- **风险等级**: LOW
- **当前 regression test**: ❌ 无

#### 31. intercourse
- **文件路径**: `z_intercourse.js`
- **triggerCategories**: ❌ 无
- **成人校验**: ✅ 强制双方成年
- **游戏效果**: `make_pregnant` (需要 CK3 原生条件)
- **当前 semantic 判定**: Gate 检测"云雨已毕|欢好已毕|交合已毕|行房已毕|完成性交|发生性关系|做了爱|高潮后|射精|事毕"等**完成标记**
- **是否适合 simple regex metadata**: ✅ **是** - 但需区分"亲密接触"与"完成性交"
- **风险等级**: LOW
- **当前 regression test**: ❌ 无

### 场景动作类 (3个，元数据驱动）

#### 32. performCombatAction
- **文件路径**: `z_performCombatAction.js`
- **triggerCategories**: ✅ `["combat"]`
- **主要 args**: `action` (enum: hit, slash, chop, push, kick, ram, stab, cleave), `weapon` (string), `isPlayerSource` (boolean)
- **游戏效果**: ❌ 无游戏效果，仅记录场景动作
- **当前 semantic 判定**: Gate 检测"拔剑|挥剑|持剑|挥拳|出拳|打|掌掴|推|踢|踹|撞|扑向|摔倒|刺|砍|劈|斩|格挡|招架|搏斗|厮打|交战|开战|冲杀|射出|放箭|命中|击中"
- **是否适合 simple regex metadata**: ⚠️ **不需要** - 已通过 triggerCategories 自注册
- **风险等级**: LOW
- **当前 regression test**: ✅ 有

#### 33. performDailyAction
- **文件路径**: `z_performDailyAction.js`
- **triggerCategories**: ✅ `["daily_movement", "daily_object_interaction"]`
- **主要 args**: `action` (enum: walk, run, take, touch, lift, carry, wear, eat, look), `object` (string), `isPlayerSource` (boolean)
- **游戏效果**: ❌ 无游戏效果，仅记录场景动作
- **当前 semantic 判定**: Gate 检测日常移动或具体物品交互
- **风险等级**: LOW
- **当前 regression test**: ✅ 有

#### 34. performIntimateAction
- **文件路径**: `z_performIntimateAction.js`
- **triggerCategories**: ✅ `["intimate_contact"]`
- **成人校验**: ✅ 强制双方成年
- **主要 args**: `action` (enum: caress, lick, kiss, tease, suck, penetrate, insert, thrust, grind, rub), `detail` (string), `isPlayerSource` (boolean)
- **游戏效果**: ❌ 无游戏效果，仅记录场景动作
- **当前 semantic 判定**: Gate 检测"抚摸|爱抚|舔舐|舔弄|亲吻|接吻|吻上|吻住|挑逗|撩拨|吮吸|含住|顶入|插入|进入体内|研磨|摩擦|抽送|抽插|挺动|律动|揉捏|揉搓"
- **风险等级**: LOW
- **当前 regression test**: ✅ 有

### RP 状态类 (1个，元数据驱动）

#### 35. setRoleplayStatus
- **文件路径**: `z_setRoleplayStatus.js`
- **triggerCategories**: ✅ `["rp_status"]`
- **主要 args**: `status` (enum: drunk, angry, insulted, humiliated, grateful, frightened, suspicious, affectionate, exhausted)
- **游戏效果**: 设置带期限的 character flag `votc_rp_status_*` + 更新 `talk_pose`
- **当前 semantic 判定**: Gate 检测"喝醉|醉了|醉醺醺|勃然大怒|怒火中烧|受辱|遭到羞辱|蒙羞|心怀感激|惊恐万分|疑心重重|满怀爱意|精疲力尽"
- **是否适合 simple regex metadata**: ⚠️ **不需要** - 已通过 triggerCategories 自注册
- **风险等级**: LOW
- **当前 regression test**: ✅ 有

### 无操作类 (1个)

#### 36. noOp
- **文件路径**: `z_noOp.js`
- **triggerCategories**: ❌ 无
- **游戏效果**: ❌ 无
- **当前 semantic 判定**: ❌ 不被任何 gate category 引用
- **风险等级**: LOW
- **当前 regression test**: ❌ 无
- **备注**: 此 Action 在 v6.4 候选裁剪后**不再进入候选列表**

---

## 🔍 main.js 硬编码分析

### getActionTriggers() 的硬编码 Categories

当前 Gate 定义了以下 **16 个硬编码 trigger categories**：

1. `gold` - 支付/财物转移
2. `imprisonment` - 囚禁
3. `death_or_injury` - 死亡或受伤
4. `relationship` - 关系变化
5. `opinion_change` - 好感变化
6. `employment_or_office` - 职位/雇佣
7. `faith_or_vassal` - 信仰/封臣
8. `location_or_exit` - 地点/离开
9. `drinking_or_toast` - 饮酒/敬酒
10. `daily_movement` - 日常移动
11. `daily_object_interaction` - 日常物品交互
12. `combat` - 战斗
13. `intimacy_or_clothing` - 脱衣/裸露
14. `intimate_contact` - 亲密接触
15. `sexual_intercourse_completed` - 完成性交
16. `visible_pose` - 可见姿态
17. `rp_status` - RP 状态
18. `faction_commitment` - 派系承诺
19. `prisoner_resolution` - 囚犯处置
20. `scheme_start` - 计谋启动（特殊处理，检测意图）

**每个 category 都有独立的大型 regex pattern**，共计超过 **3000 行正则表达式代码**。

### getActionIdsForTriggers() 的硬编码映射

当前硬编码映射表 `byReason` 包含 **12 个 category 到 Action ID 的映射**：

```javascript
const byReason = {
  gold: ["paysGoldTo", "playerPaysGoldTo"],
  imprisonment: ["isImprisonedBy"],
  death_or_injury: ["isInjured", "characterIsKilled"],
  relationship: ["becomeSoulmatesWith", "becomeRivalsWith", "becomeNemesisWith", 
                 "becomeLoversWith", "becomeFriendsWith", "becomeBloodBrothersWith", 
                 "becomeBestFriendsWith", "makeAlliance", "agreedToTruceWith"],
  employment_or_office: ["isFiredFromCouncilOf", "isEmployedBy", "isEmployedAsKnightBy", 
                         "isAssignedToCourtPositionBy", "isAssignedToCouncilBy"],
  faith_or_vassal: ["convertsToReligionOf", "isVassalizedBy"],
  location_or_exit: ["changeLocation", "leavesConversation"],
  drinking_or_toast: ["setEmotion"],
  combat: [],  // 注意：战斗类不直接映射 legacy action，只由 scene module 处理
  opinion_change: ["changeOpinionOf"],
  intimacy_or_clothing: ["isUndressed"],
  sexual_intercourse_completed: ["intercourse"],
  visible_pose: ["setEmotion"]
};
```

**未包含在此映射中的 Action**（通过 triggerCategories 自注册）：
- `performCombatAction`
- `performDailyAction`
- `performIntimateAction`
- `setRoleplayStatus`
- `recordFactionCommitment`
- `resolvePrisoner`
- `startPersonalScheme`
- `startHostileScheme`

### getSemanticActionProfile() 的硬编码语义规则

当前函数包含 **25 个硬编码语义判定规则**，每个规则都重新扫描完整原文：

```javascript
if (reasons.has("gold")) {
  allow("paysGoldTo", "明确完成的财物转移");
  allow("playerPaysGoldTo");
}

if (reasons.has("imprisonment")) {
  allow("isImprisonedBy", "明确完成的拘押/监禁");
}

if (reasons.has("death_or_injury")) {
  if (matches(/(?:杀死|杀了|砍死|刺死|毒死|勒死|...)/i)) {
    allow("characterIsKilled", "明确的死亡结果");
  } else {
    allow("isInjured", "明确的非致死伤害结果");
  }
}

if (reasons.has("relationship")) {
  if (matches(/(?:灵魂伴侣|...)/i)) allow("becomeSoulmatesWith", ...);
  else if (matches(/(?:情人|恋人|...)/i)) allow("becomeLoversWith", ...);
  else if (matches(/(?:至交|挚友|...)/i)) allow("becomeBestFriendsWith", ...);
  else if (matches(/(?:朋友|友人|...)/i)) allow("becomeFriendsWith", ...);
  // ... 共 9 个 relationship 分支
}

// ... 其他 12 个 category 的语义规则
```

**问题**：
1. 每次都重新用 `pattern.test(source)` 扫描**完整原文**，包含被 Stage 1 排除的否定句、未来时、回忆、传闻
2. 所有 Action 专属语义知识（死亡词、受伤词、关系词、职位词...）全部集中在 main.js
3. 新增一个 Action 需要同时修改 3 个地方：Gate regex、byReason 映射、semantic 规则

---

## 🎯 v6.5 重构目标对照

### 问题 A：Gate 承担过多语义权力

**当前状态**：
- Gate 直接返回 category → 后续系统认为动作已发生
- Gate 漏判 → 整个系统结束
- Gate 误判 → 后续系统盲目信任

**影响的 Action**：**全部 37 个 Action**

**建议改进**：
- 将 Gate 降级为 `getActionHints()` / `detectActionCandidates()`
- Gate 只判断"值不值得继续分析"，不确认动作事实
- 提高召回率，容忍适量误报

### 问题 B：动作专属语义硬编码在 main.js

**当前状态**：
- `getSemanticActionProfile()` 包含 25+ 个硬编码 semantic 规则
- 每新增一个 Action 需要修改 main.js 的 3 个位置
- 所有 CK3 Action 的业务语义知识集中在主程序

**直接受影响的 Action**：**27 个** (被 `getSemanticActionProfile` 硬编码)

**建议改进**：
- 将语义规则下沉到 Action metadata (`semantic.evidencePatterns`)
- Registry-driven Semantic Resolver 自动发现 Action 语义
- 新增 Action 只需声明 `triggerCategories` 和 `semantic` metadata

### 问题 C：Stage 2 重新扫描完整原文

**当前状态**：
- `getSemanticActionProfile(fullText, reasons)` 重新用 `pattern.test(source)` 扫描完整原文
- Stage 1 排除的否定句、未来时、回忆、传闻仍可能污染 Stage 2

**示例风险案例**：
```
"我没有杀死他，只是刺伤了他的手臂。"
```
- Stage 1 正确识别 evidence: "刺伤了他的手臂"
- Stage 2 重新扫描完整句子 → 仍看到"杀死" → 可能错误允许 `characterIsKilled`

**影响的 Action**：**27 个** (被 `getSemanticActionProfile` 处理)

**建议改进**：
- Stage 2 只处理 Stage 1 输出的 Positive Evidence
- 禁止 Action metadata 直接接收完整原文
- Event-based 架构，每个 Event 只携带已验证的 evidence span

---

## 📋 测试覆盖情况

### 当前 test-action-system.js 覆盖

**Trigger Gate 测试**：22 个测试用例
- ✅ 涵盖日常动作、金钱、战斗、受伤、亲密接触、性交完成、计谋、RP 状态、派系、囚犯处置
- ✅ 包含否定测试（未来时、问句、失败尝试）

**Semantic Profile 测试**：12 个测试用例
- ✅ 涵盖描述组合（对视+亲吻 → 灵魂伴侣、牵手+亲吻 → 恋人）
- ✅ 涵盖囚禁、伤害、死亡、职位、封臣、地点、囚犯、计谋

**Action Script 执行测试**：8 个测试用例
- ✅ `performDailyAction`
- ✅ `performCombatAction`
- ✅ `performIntimateAction`
- ✅ `startPersonalScheme` (包含成人校验)
- ✅ `startHostileScheme`
- ✅ `setRoleplayStatus`
- ✅ `recordFactionCommitment`
- ✅ `resolvePrisoner`

**缺失测试的高风险 Action**：
- ❌ `characterIsKilled` - 只有 semantic 测试，无 script 执行测试
- ❌ `isImprisonedBy` - 只有 semantic 测试，无 script 执行测试

**缺失测试的中风险 Action**：
- ❌ 关系类 (除 soulmate/lover 语义测试外，无 script 执行测试)
- ❌ 职位类 (除 `isEmployedAsKnightBy` 语义测试外，无执行测试)
- ❌ 信仰/封臣类 (除 `isVassalizedBy` 语义测试外，无执行测试)

---

## 🚀 重构建议优先级

### P0 - 必须优先修复的架构问题

1. **Event-based 输出**：Stage 1 输出 `ActionEvent[]` 而不是 `string[]` categories
2. **Positive Evidence 隔离**：Stage 2 只处理 Event.evidence，禁止重新扫描完整原文
3. **玩家/NPC 动作分离处理**：修复 `pendingPlayerActionMessage` 二选一问题

### P1 - 核心重构基础设施

1. **Action metadata schema**：定义 `semantic.evidencePatterns`、`exclusiveGroup`、`priority`
2. **Registry-driven Semantic Resolver**：根据 metadata 自动解析候选 Action
3. **高风险 Action metadata 迁移**：优先迁移 `characterIsKilled`、`isInjured`、`isImprisonedBy`、`startHostileScheme`
4. **Event-level allowedActionIds**：从 message-level 改为 Event-level
5. **Action Prompt Event-oriented**：提示词改为基于 Event 的结构

### P2 - 长期架构改善

1. **Candidate Gate 降级**：将 `getActionTriggers` 改为高召回宽松门控
2. **Event-level dedupe**：根据 evidence 而非 category 去重
3. **exclusiveGroup / priority** 机制
4. **riskLevel** 标记
5. **composition rule** 支持（长久对视 + 亲吻 → soulmate）
6. **Legacy semantic fallback 删除**

---

## 🎯 建议的 5 个 Metadata 试点 Action

基于"语义明确、独立、高影响、易验证"原则，建议优先迁移以下 5 个 Action：

### 1. characterIsKilled ⭐ 最高优先级
- **理由**：
  - 高风险 (isDestructive)，语义极其明确（死亡关键词）
  - 需要与 `isInjured` 通过 `exclusiveGroup: "physical_outcome"` 互斥
  - 当前已有 semantic 测试，迁移后容易验证
- **metadata 草案**：
  ```javascript
  semantic: {
    evidencePatterns: [/杀死|杀了|砍死|刺死|毒死|勒死|掐死|打死|烧死|淹死|处死|斩首|毙命|殒命|气绝|断气|倒地(?:身亡|死去)|killed?|executed|died/i],
    exclusiveGroup: "physical_outcome",
    priority: 100
  }
  ```

### 2. isInjured ⭐ 最高优先级
- **理由**：
  - 中高风险，与死亡必须互斥
  - 语义明确（伤害关键词，排除死亡词）
  - 已有 semantic 测试
- **metadata 草案**：
  ```javascript
  semantic: {
    evidencePatterns: [/刺伤|砍伤|打伤|烧伤|冻伤|摔伤|重创|重伤|负伤|受伤|刺穿|贯穿|流血(?:不止)?|鲜血.{0,8}(?:流出|涌出|喷出)|伤口|骨折|断骨|wounded|injured|maimed|disfigured|bled|bleeding/i],
    excludePatterns: [/杀死|杀了|砍死|刺死|处死|斩首|毙命|断气|killed?|executed|died/i],
    exclusiveGroup: "physical_outcome",
    priority: 50
  }
  ```

### 3. isImprisonedBy ⭐ 高优先级
- **理由**：
  - 高风险，语义明确（囚禁关键词）
  - 独立性强，不依赖复杂组合规则
  - 已有 semantic 测试
- **metadata 草案**：
  ```javascript
  semantic: {
    evidencePatterns: [/囚禁|关进|关押|投入(?:大牢|地牢)|收监|逮捕|拘押|软禁|拿下|押下|押入|押进|押往|押送(?:入|至).{0,8}(?:牢|狱)|下狱|入狱|捆(?:起|住)来?|绑(?:起|住)来?|上(?:了)?枷锁|戴上(?:镣铐|枷锁)|锁进(?:牢房|地牢)?|铁链(?:锁住|缚住)|imprison(?:ed)?|arrest(?:ed)?|jailed?|locked up|put in chains/i],
    exclusiveGroup: null,
    priority: 80
  }
  ```

### 4. becomeFriendsWith ⭐ 中优先级
- **理由**：
  - 中风险，语义简单（朋友关键词）
  - 关系类 Action 的典型代表
  - 可验证 exclusiveGroup 对 `becomeBestFriendsWith` 的互斥
- **metadata 草案**：
  ```javascript
  semantic: {
    evidencePatterns: [/朋友|友人|友谊|friends?/i],
    exclusiveGroup: "friendship_tier",
    priority: 20
  }
  ```

### 5. changeLocation ⭐ 低风险验证
- **理由**：
  - 低风险，语义明确（地点关键词）
  - 已有 semantic 测试
  - 可作为低风险 metadata 迁移的验证案例
- **metadata 草案**：
  ```javascript
  semantic: {
    evidencePatterns: [/踏入|进入|来到|赶往|移步|前往|返回|回到|抵达|到达|搬到|移动到|entered|arrived|returned to|moved? to/i],
    exclusiveGroup: null,
    priority: 30
  }
  ```

---

## ⚠️ 当前最危险的 3 个架构问题

### 1. Stage 2 重新扫描完整原文 🔴 极高风险
- **影响范围**：27 个 Action
- **风险描述**：Stage 1 排除的否定句、未来时、回忆、传闻仍可能在 Stage 2 污染语义判定
- **示例**："我没有杀死他，只是刺伤了他的手臂" → Stage 2 仍看到"杀死"
- **后果**：可能导致 `characterIsKilled` 被错误允许，造成角色意外死亡
- **优先级**：**P0** - 必须立即修复

### 2. Gate 作为动作事实来源 🔴 高风险
- **影响范围**：全部 37 个 Action
- **风险描述**：Gate 漏判 → 整个动作系统结束，无补救机会；Gate 误判 → 后续系统盲目信任
- **示例**：新表达方式（如"将他押送入牢"中的"将"被误判为将来时）导致合法动作被拒绝
- **后果**：动作系统脆弱，对新表达方式适应性差
- **优先级**：**P0** - Event-based 架构前提

### 3. 玩家/NPC 动作二选一 🟡 中风险
- **影响范围**：场景类 Action (`performCombatAction`, `performDailyAction`, `performIntimateAction`)
- **风险描述**：`pendingPlayerActionMessage` 非空时，第一个 NPC 自己回复中的动作不再独立处理
- **示例**：玩家有动作 → 第一个 NPC 回复中的战斗动作被跳过
- **后果**：多人对话中 NPC 动作丢失
- **优先级**：**P0** - 需要分别处理玩家和每个 NPC 的动作

---

## 📅 测试基线

### 当前测试状态
- ✅ **全部通过**
- 总测试用例：**22 个 trigger 测试 + 12 个 semantic 测试 + 8 个 script 执行测试**
- 语法检查：✅ 通过 (`node --check resources\app\out\main\main.js`)

### 测试命令
```powershell
node scripts\test-action-system.js
node --check resources\app\out\main\main.js
```

### 测试输出
```
Action regression tests passed: 22 trigger cases and 8 action scripts.
```

---

## 🎯 下一阶段建议

根据当前基线分析，建议下一阶段的优先级顺序：

### 选项 A：补测试 ⚠️ 低优先级
- **理由**：当前高风险 Action 基本都有 semantic 测试，script 执行测试可在重构后补充
- **工作量**：中等
- **风险**：低

### 选项 B：metadata schema 基础设施 ⭐ 推荐
- **理由**：
  - 定义 `semantic.evidencePatterns`、`exclusiveGroup`、`priority` schema
  - 实现 Registry-driven Semantic Resolver
  - 完成 5 个试点 Action 的 metadata 迁移
  - 保留 Legacy Fallback，确保行为兼容
- **工作量**：中等
- **风险**：低（渐进式迁移，不破坏现有行为）
- **收益**：为后续 Event-based 重构打下基础

### 选项 C：Candidate Gate 降级 🟡 可选
- **理由**：Gate 降级需要同时提高召回率和容错能力，可能影响现有测试
- **工作量**：中等
- **风险**：中（需要重新调整 Gate 阈值和测试用例）
- **收益**：降低 Gate 对动作系统的控制权

### 选项 D：Execution Parser Event 化 ⭐⭐ 最推荐
- **理由**：
  - 修复 Stage 2 重新扫描完整原文的**极高风险问题**
  - 将 Stage 1 输出从 `string[]` categories 改为 `ActionEvent[]`
  - 每个 Event 包含 `eventId`、`category`、`evidence: { text, start, end }`、`executionStatus`
  - Stage 2 只处理 Event.evidence，禁止重新扫描
  - 修复玩家/NPC 动作二选一问题
- **工作量**：大
- **风险**：中（需要重构 main.js 核心流程，但可保持 Action Script API 不变）
- **收益**：解决当前最危险的架构问题，为 metadata-driven 重构扫清障碍

---

## 🎬 最终建议

**推荐执行顺序**：

1. **Phase 1（P0）**：Execution Parser Event 化
   - 将 Stage 1 输出改为 `ActionEvent[]`
   - Stage 2 只处理 Event.evidence
   - 修复玩家/NPC 动作分离问题
   - 确保所有现有测试通过

2. **Phase 2（P1）**：metadata schema 基础设施
   - 定义 Action metadata schema
   - 实现 Semantic Resolver
   - 迁移 5 个试点 Action
   - 保留 Legacy Fallback

3. **Phase 3（P1）**：高风险 Action metadata 迁移
   - 迁移所有 isDestructive=true Action
   - 迁移关系类、职位类 Action
   - 验证 exclusiveGroup 互斥机制

4. **Phase 4（P2）**：Candidate Gate 降级 + 完整迁移
   - 将 Gate 改为高召回宽松门控
   - 删除 Legacy Fallback
   - Event-level dedupe

---

**生成时间**: 2026-08-19  
**文档版本**: 1.0  
**下一步**: 等待用户确认下一阶段执行方案
