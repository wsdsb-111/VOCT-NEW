# VOCT V9.3.7 施工方案：年龄事实校准与双亲关系补全

- 目标版本：V9.3.7
- 基线：V9.3.6.3
- 状态：待施工
- 仓库：`wsdsb-111/VOCT-NEW`
- 原则：修复现有数据链路，不重写关系系统、Worldline 或 Memory 检索架构。

## 0. 版本目标

本版解决两个实机问题：

1. 人物关系提取正常、年龄也进入 Prompt，但 NPC 回答年龄仍可能比 CK3 实际年龄大一岁。
2. 玩家妻子与妾室所生子女可以识别共同父亲 / 兄弟姐妹关系，却可能不知道彼此各自的母亲是谁。

年龄问题不能仅凭代码静态检查断言唯一根因。必须先找出偏差第一次出现在哪一层，再按证据修复。亲属问题则需要核实 `otherParent` 是否从解析结果进入关系证据、关系图和最终家庭事实块。

### 必须保留

- V9.3.6.2 的低延迟 Pair 检索与缓存收益。
- V9.3.6.3 的年龄权威来源框架、第三人时间召回、重新生成轮次恢复。
- Owner / Target / Pair 权限、Campaign 隔离、Forget 语义、Source Revision 复验。
- 旧摘要局部回退；不得因少量旧数据异常触发所有 Pair 全量扫描。
- 现有 Prompt Token 预算，不得无差别扩大上下文来“修复”家庭认知。

### 明确禁止

- 不对所有计算年龄统一减一。
- 不把妻子和妾室之间强行建立亲属 / 配偶边。
- 不把“游戏数据存在亲子关系”自动等同于“所有 NPC 都知道该关系”。
- 不编造未知父母，不泄露秘密亲子关系。
- 不以删除旧 Memory、跳过来源校验或增加全量扫描换取正确率。

---

## 1. 相关代码基线

施工前确认分支 HEAD 与部署文件映射，以下路径基于 V9.3.6.3 已审查代码。

### 年龄链路

- `src/app/main/game-data/character.js`
- `src/app/main/game-data/log-parser.js`
- `src/app/main/game-data/relationship-resolver.js`
- `src/app/main/worldline/character-age-service.js`
- `src/app/main/worldline/character-temporal-facts.js`
- `src/app/main/worldline/family-entity-fact-bundle.js`
- `src/app/main/worldline/character-family-facts.js`
- `src/app/main/prompts/prompt-builder.js`
- `scripts/test-v9.3.6.3-age-authority.js`

已知事实：
- `resolveCharacterAge()` 优先接受可信的 `CK3_CURRENT_AGE` / 来源绑定完整的 `CK3_LIVE_RELATIVE_AGE`。
- 可信当前年龄缺失时，存活人物会回退到 `computeAgeAtDate(birthDate, currentGameDate)`。
- `kids` / `siblings` 的相对人物记录包含出生日期与 `birthDateTotalDays`，但记录本身不直接包含 `age`。
- 已有 A13 测试证明：当前年龄为 17、日历推算为 18 时，可信当前年龄可以优先；它并不能证明所有场外亲属都有权威年龄，也不能证明 CK3 日历边界在实机中全部一致。

### 双亲关系链路

- `src/app/main/game-data/log-parser.js`
- `src/app/main/game-data/relationship-resolver.js`
- `src/app/main/worldline/character-kinship-graph.js`
- `src/app/main/worldline/relationship-current-truth.js`
- `src/app/main/worldline/family-entity-fact-bundle.js`
- `src/app/main/worldline/character-family-facts.js`
- `src/app/main/prompts/prompt-builder.js`

已知事实：
- `kid_other_parent` 会将另一位家长解析为 `currentChild.otherParent = { id, name }`。
- `sibling_other_parent` 也会保存 `currentSibling.otherParent`。
- 需要验证这些对象是否被规范化成带来源的亲子关系证据、进入关系图，并被最终家庭事实块使用。
- 正确的关系图应让两位母亲分别连接自己的子女；子女因共享父亲成为半兄弟姐妹。两位母亲之间不需要、也不应凭空建立关系边。

---

## 2. 施工阶段

| 阶段 | 任务 | 交付 / 通过标准 |
|---|---|---|
| 0 | 固定基线并复现 | 能区分原始数据错误、来源选择错误、日期计算错误、Prompt 错误与模型回答错误 |
| 1 | 年龄事实校准 | 原始值、最终值、Prompt 值可追踪；只修复被证据定位的根因 |
| 2 | 补全 `otherParent` 关系边 | 双亲可分别查询，关系来源可追踪 |
| 3 | 家庭事实注入 | 当前 NPC 在有依据且与问题相关时能得到另一方母亲信息 |
| 4 | 权限、旧档与性能回归 | 不泄密、不全量扫描、不破坏低延迟 |
| 5 | CK3 实机验收 | 两个用户可见问题均通过真实存档与真实 Provider 验收 |

---

## 3. 阶段 0：年龄问题诊断

### 3.1 固定基线

1. 记录起始 commit SHA、分支和工作区状态。
2. 比对 `src/app/main` 与 `resources/app/out/main` 的对应运行文件。
3. 保存现有测试数量、年龄专项测试、关系图测试、Prompt 测试和 Pair 性能基线。
4. 保留现有匿名 `ageDiagnostics`；诊断不得改变年龄选择、权限或 Prompt。
5. 新增代码后同步部署产物并验证资源映射。

### 3.2 增加分层匿名诊断

沿用现有 `ageDiagnostics`，按需增加以下字段：

```js
{
  targetCharacterIdHash,
  ageSource,
  rawAge,
  calculatedCalendarAge,
  selectedAge,
  asOfGameDate,
  birthDateSource,
  currentAgeSourceOwnerIdHash,
  profileSelectionPath,
  sourceConflict,
  promptAge,
  diagnosticCode
}
```

隐私要求：
- ID 哈希化；不得记录姓名、原始对话、秘密正文或完整关系图。
- 无可靠值时记录 `null` 和明确原因，不得猜值。
- 诊断只观测，不得改变实际逻辑。

### 3.3 必须区分的根因

| 诊断码 | 现象 | 修复方向 |
|---|---|---|
| `RAW_CK3_AGE_MISMATCH` | 原始 CK3 年龄已与游戏界面不一致 | 检查 CK3 输出脚本、字段语义、解析索引 |
| `RELATIVE_AGE_MISSING` | 场外亲属只有生日，没有当前年龄 | 检查能否从 CK3 导出可信当前年龄 |
| `AGE_SOURCE_SELECTION_MISMATCH` | 有可信年龄，但最终选择日历推算 | 修复来源绑定、profile 选择或权威级别 |
| `CALENDAR_AGE_MISMATCH` | 日期输入正确但推算与 CK3 不一致 | 验证 CK3 年龄规则、日期转换和边界 |
| `PROFILE_AGE_STALE` | 原始数据已更新，最终 profile / 缓存仍旧 | 检查快照刷新、缓存键和失效机制 |
| `PROMPT_AGE_MISMATCH` | Worldline 选择值正确，Prompt 却不同 | 检查 bundle 合并与格式化 |
| `MODEL_ANSWER_MISMATCH` | Prompt 正确，模型仍答错 | 检查冲突事实、Prompt 优先级，并做真实 Provider 验收 |

### 3.4 复现夹具

每个夹具记录：CK3 日期与界面年龄、原始字段、目标是否存在于完整 Character Map、年龄来源、Worldline 最终年龄、最终 Prompt 年龄、模型回答。

至少覆盖：
1. 当前年龄可信且与日历推算一致。
2. 当前年龄可信、日历推算故意为 `n + 1`。
3. 当前年龄缺失、生日已过 / 尚未到 / 生日当天。
4. 场外子女只存在于亲属记录。
5. 同一目标从场外亲属变为完整人物。
6. 无效日期、未来生日、闰日出生。
7. 年龄证据冲突。
8. 当前年龄更新后再次查询，不能返回旧缓存。

---

## 4. 阶段 1：修复年龄事实链路

### 4.1 唯一年龄选择入口

继续以 `resolveCharacterAge()` 为唯一年龄选择入口。不得在关系解析器、Family Bundle 和 Prompt Builder 中分别实现不同算法。

优先级：
1. 可信 CK3 当前年龄。
2. 来源绑定完整、属于当前快照的 CK3 亲属当前年龄。
3. 经实机验证与 CK3 年龄规则一致的生日 / 当前游戏日期计算。
4. 证据不足时输出年龄未知并记录原因。

不能凭姓名、图中存在该人物或仅有出生日期，就将年龄提升为权威事实。

### 4.2 检查 CK3 亲属输出

检查 CK3 脚本 / 日志生成器是否能为 `kids`、`siblings`、`parents` 输出当前年龄。

若能可靠输出：
- 为对应记录增加稳定的年龄字段。
- 解析器同时写入 `age` 与 `ageSource`，不能只有裸数字。
- 来源标签区分完整人物与亲属快照，如 `CK3_CURRENT_AGE`、`CK3_LIVE_RELATIVE_AGE`。
- 亲属年龄必须绑定 `sourceOwnerId`、`relationType` 和非空来源。
- 同一人物多份记录按 Runtime ID 合并，再按权威级别与来源新鲜度选择。
- 旧亲属快照不得覆盖较新的完整人物年龄。
- 同级来源冲突必须记录冲突，不能简单“最后写入者获胜”。

若无法从 CK3 接口直接得到年龄：
- 不得伪造 `CK3_CURRENT_AGE` 标签。
- 先验证 CK3 日期和年龄规则。
- 只有经实机对照确认一致的算法才可作为可靠回退。
- 未验证时，冲突或缺失场景输出未知，不把未经验证的推算包装成确定事实。

### 4.3 检查 profile 选择和来源绑定

重点审查 `character-family-facts.js` 中的 `sourceBoundFamilyProfile()`、`ageAuthorityGameData` 与 `resolveCharacterAge()` 调用：

- 目标 Runtime ID 是否始终一致。
- 完整人物 profile 与相对人物 profile 是否来自同一快照。
- `characters` Map 已有当前人物时，是否仍选中字段更少或更旧的 mentionable profile。
- `CK3_LIVE_RELATIVE_AGE` 是否因 Owner ID 类型、关系类型或 evidence 缺失而被错误降级。
- 当前年龄证据存在时是否仍被错误回退到日历计算。
- `selectedAge` 是否绑定正确目标人物，而不是按姓名或数组顺序匹配。
- 年龄查询是否误用了另一轮 / 另一场景的游戏日期或 `ageAuthorityGameData`。

优先统一 profile 的权威合并规则，不得绕过 `trustedCurrentAge()` 的来源验证。

### 4.4 日期边界与日历语义

在 `character-temporal-facts.js` 中测试：
- 生日之前、当天、之后；
- 跨年；
- 2 月 29 日出生；
- 无效日期、未来出生日期；
- CK3 日期与 `totalDays` 一致 / 冲突；
- 仅有 `totalDays` 或仅有日期字符串。

约束：
- `birthDateTotalDays` 未经验证不得直接当作公历序列天数。
- 不用固定 `365` 或 `365.2425` 年差替代生日边界。
- 日期字符串解析成功不代表游戏日历语义已验证。
- 不对所有年龄统一减一。

若 CK3 实际规则不同，应封装成有测试的专用适配函数，并明确适用数据来源，不能破坏其它日期计算。

### 4.5 保证最终 Prompt 一致

对“你儿子今年多大”等明确问题：
- 仅对唯一解析的目标输出年龄。
- 最终家庭事实块必须使用 `resolveCharacterAge()` 的选定结果。
- 同一事实块不得出现两个未标注时间的冲突年龄。
- 历史摘要年龄必须绑定历史时间，不能冒充当前年龄。
- 可信当前年龄优先于旧摘要中未标时间的年龄。
- 当前年龄未知或来源冲突时，明确输出未知，禁止模型自行推算。

若 Prompt 已正确但模型仍答 `n + 1`，归类为 `MODEL_ANSWER_MISMATCH`；检查其它 Prompt 区块中的冲突值，勿继续修改日期算法，也勿靠增加无关 Token 解决。

---

## 5. 阶段 2：把 `otherParent` 纳入关系图

### 5.1 期望图结构

示例人物：
- P：共同父亲；
- W：妻子；
- C：妾室；
- A：W 与 P 的子女；
- B：C 与 P 的子女。

```text
W ──PARENT_OF──> A <──PARENT_OF── P
C ──PARENT_OF──> B <──PARENT_OF── P

A ──SIBLING_OF── B
```

不建立 W 与 C 之间的配偶或亲属边。A、B 的兄弟姐妹关系来自共同父亲 P；两位母亲分别连接自己的子女。

### 5.2 解析与证据规范化

涉及 `log-parser.js`、`relationship-resolver.js`。

目前 `kid_other_parent` / `sibling_other_parent` 保存 `{ id, name }`。保留旧字段以兼容调用方，并把它规范化为带来源的关系证据。

每条证据至少绑定：
- `childId`；
- `otherParentId`；
- `sourceOwnerId` 或现有架构中的 Owner；
- `relationType: "parent"`；
- 非空来源标识；
- 当前快照 / Campaign 信息（使用项目已有字段）。

规则：
1. 以 Runtime ID 为主键，姓名仅用于显示。
2. 无效 ID、零值、自指边不生成关系。
3. 只有姓名没有 ID 时不得按姓名建确定亲子边。
4. 若另一位家长已存在完整 profile，复用可信资料；若只有 ID / 姓名，只创建受限节点，不虚构年龄、性格或 Memory。
5. 重复证据去重；不同来源冲突时保留冲突诊断，不以最后写入者覆盖。
6. 对 `kids` 记录，补充的是 child 与 `otherParent` 的第二条亲子边。
7. 对 `siblings` 记录，先验证 root、sibling、otherParent 的语义，防止把 sibling 的另一位家长错接到 root。
8. `otherParent` 不得自动转为 `SPOUSE_OF`、`CONCUBINE_OF` 等伴侣关系。

### 5.3 Kinship Graph

涉及 `character-kinship-graph.js`。

- 把可信第二家长证据转为可双向查询的 `PARENT_OF` / `CHILD_OF` 边。
- 沿用现有图构建和关系解析 API，不新建与主图脱节的家谱。
- 共享父母推导兄弟姐妹关系时按 ID 去重。
- 共享父亲、不同母亲应得到半兄弟姐妹关系；不能合并母亲。
- 父母 ID 有效但完整 profile 不存在时，允许最小关系节点，但不得获得完整人物资料或 Memory 读取权限。
- 父母证据冲突时，只输出可信部分；不将冲突包装成确定事实。
- 不因新增 `otherParent` 遍历所有人物或历史摘要。

### 5.4 关系事实与人物知情状态分离

必须区分：
1. **Worldline 关系事实：** 数据来源证明的亲子关系。
2. **当前 NPC 上下文：** 回答本轮问题需要的事实。
3. **人物知情状态：** NPC 是否有依据知道该身份。
4. **Memory 权限：** 是否允许读取对应 Owner / Pair 的历史。

新增亲子边不能自动授权 Memory 读取，也不能自动证明秘密亲子关系已公开。若 CK3 数据无法判断公开状态 / NPC 知情状态，则不得输出确定的“NPC 已知晓”事实；沿用现有秘密与权限策略。

---

## 6. 阶段 3：家庭事实块补全

涉及：
- `family-entity-fact-bundle.js`
- `character-family-facts.js`
- `relationship-current-truth.js`
- `prompt-builder.js`

### 6.1 只注入当前查询需要的关系

对“你兄弟的母亲是谁”“你们是否同父异母”等问题：

1. 解析关系主体、目标人物与关系类型。
2. 通过 Runtime ID 定位目标。
3. 从现有关系图读取目标已确认的父母边。
4. 当目标为兄弟姐妹时，按需读取该兄弟姐妹的父母信息。
5. 仅输出已确认且与问题相关的少量事实。
6. 保留来源级别、完整性和知情状态。
7. 有歧义时沿用 `RELATION_AMBIGUOUS`，不得任选候选并注入私有事实。

### 6.2 输出示例

以下为格式示例，不代表真实角色：

```text
=== 当前结构化家庭事实（本轮 CK3 数据） ===
- 当前 NPC：角色 A
- 查询目标：角色 B（Runtime ID 已解析）
- 已确认共同父亲：角色 P
- 角色 A 的已确认母亲：角色 W
- 角色 B 的已确认母亲：角色 C
- 关系结论：A 与 B 是同父异母兄弟姐妹
- 知情状态：仅在来源支持时输出；未知时不得宣称 NPC 已知晓
- 来源状态：当前 CK3 关系证据；不完整时明确标记
```

禁止：
- 无关时输出整张家谱；
- 把未确认母亲写成确定姓名；
- 把“同父异母”推断成亲密、敌对或彼此知情；
- 把历史婚姻状态当成当前状态；
- 自动注入其它 Owner 的 Memory；
- 把秘密亲子关系直接当成 NPC 已知事实。

### 6.3 历史摘要与当前事实

- 当前结构化关系负责“当前关系是什么”。
- 历史摘要负责“过去发生了什么”。
- 旧摘要冲突时先核对时间和来源，不能直接拼成矛盾事实。
- 不删除历史摘要；应保留历史事实的时间语义。
- 关系图扩展不改变 Owner、Campaign、Forget 和 Source Revision 权限。

### 6.4 性能与 Token

- 只注入目标相关的父母和必要的共享父母事实。
- 不递归展开所有祖父母、叔伯、堂表亲和伴侣。
- 优先使用现有 ID 索引和关系图。
- 不为家庭关系补全而注入整段历史摘要。
- 记录家庭事实块 Token 数、关系图节点 / 边访问计数及构建耗时。
- 无关对话不得因新增逻辑触发大范围工作。
- 旧数据缺少 `otherParent` 时保持兼容，不全量回退。

---

## 7. 测试矩阵

### 7.1 年龄测试

- 可信 `CK3_CURRENT_AGE` 优先于冲突日历推算。
- `CK3_LIVE_RELATIVE_AGE` 仅在来源绑定完整时可信。
- 完整人物 profile 比旧亲属快照更新时选择最新可信值。
- 亲属当前年龄缺失时有明确回退来源。
- 生日之前 / 当天 / 之后、闰日、无效日期、未来生日。
- 日期字符串与 `totalDays` 一致 / 冲突。
- 当前年龄冲突时不任意选择。
- 年龄未知时 Prompt 明确输出未知。
- 年龄更新后缓存不返回旧值。
- Prompt 正确但模型回答错误时归类为 `MODEL_ANSWER_MISMATCH`。

### 7.2 关系图测试

合成 P、W、C、A、B 家庭，P 是共同父亲，A 的另一位家长为 W，B 的另一位家长为 C。

必须验证：
- `PARENT_OF(P, A)`、`PARENT_OF(P, B)`；
- `PARENT_OF(W, A)`、`PARENT_OF(C, B)`；
- A 与 B 是兄弟姐妹；
- A 的母亲是 W，B 的母亲是 C；
- W 与 C 之间没有虚假配偶 / 亲属边；
- 不合并两位母亲；
- 关系证据的 child、otherParent、Owner 和来源均正确；
- 重复证据去重；
- 缺失 / 无效 ID、只有姓名、来源冲突时保守处理；
- 受限节点不获得虚构年龄、秘密或 Memory；
- 未知 / 秘密亲子关系不会自动成为 NPC 已知事实。

### 7.3 Prompt 与权限测试

- A 询问 B 的母亲、B 询问 A 的母亲。
- 同父异母关系。
- 只知道共同父亲、不知道另一位家长。
- 同名角色与关系歧义。
- 秘密亲子关系 / 知情状态未知。
- 历史摘要与当前关系冲突。
- 无关问题不注入家庭扩展内容。
- 多人对话只注入当前目标相关事实。
- Regenerate 前后结构化事实选择一致。
- 不因 `otherParent` 新增 Memory 读取授权。
- Campaign、Forget、来源修订和 Owner 隔离测试继续通过。

### 7.4 性能回归

以 V9.3.6.3 同环境对比，记录年龄解析、家庭事实构建、图访问量、Prompt Token、Pair 检索耗时和缓存命中。

初始验收门槛：
- 暖态普通对话家庭事实构建 P95 相对基线增幅不超过 10%。
- 普通对话 Prompt Token 中位数增幅不超过 5%；家庭专项查询的增幅必须与新增事实量相符。
- Pair 检索不得出现系统性退化。
- 不得跳过来源校验、秘密检查或延长不合理的缓存有效期来换性能。

以上为工程门槛，不是已测得的结果。报告必须注明样本量、缓存状态与测试环境。

---

## 8. CK3 实机验收

离线测试通过后，必须使用真实存档与真实 Provider 验收。

### 年龄场景

至少选 3 名人物：完整 Character 中有可信年龄者、只在亲属记录中出现的场外子女、生日边界附近人物。记录 CK3 日期 / 界面年龄、原始解析字段、年龄来源、Worldline 年龄、Prompt 年龄、模型回答及 Regenerate 差异。

合格标准：数据可信时结构化年龄与 CK3 界面一致，模型回答与结构化事实一致；数据不足时明确未知，不猜测。

### 妻子 / 妾室子女场景

1. 确认两个子女的 Runtime ID。
2. 确认 CK3 数据是否分别输出 `otherParent`。
3. 检查规范化后的两条母子 / 母女边。
4. 检查关系图能分别解析两位母亲。
5. 让两名 NPC 对话并询问 / 提及各自母亲。
6. 检查最终家庭事实块。
7. 验证 NPC 不会凭空获得秘密身份知识。
8. 对同一问题重新生成至少 3 次，确认结构化事实选择一致。
9. 记录延迟与 Token，确保没有全量扫描。

### 失败归属

| 失败位置 | 责任模块 |
|---|---|
| CK3 输出没有年龄 | 脚本 / 导出覆盖 |
| 输出有年龄但解析丢失 | `log-parser.js` / Character 解析 |
| 有可信年龄却使用日历值 | 年龄来源选择 |
| Worldline 正确但 Prompt 错 | Family Bundle / Prompt Builder |
| Prompt 正确但模型答错 | Provider / Prompt 遵循 |
| 有 `otherParent` 但无关系边 | Relationship Resolver / Kinship Graph |
| 图正确但 Prompt 缺失 | Family Bundle / Prompt Builder |
| Prompt 有母亲但 NPC 表现不知情 | 人物知情模型 / Prompt / 模型遵循 |
| 新逻辑泄露秘密 | P1 安全回归失败，禁止发布 |

---

## 9. 提交拆分建议

### Commit A：年龄诊断与权威选择
修改年龄服务、日期服务、关系档案和家庭事实相关代码。先增加失败夹具，再修复有证据支持的来源选择 / 日期计算 / 数据缺失问题。

### Commit B：`otherParent` 关系规范化
修改解析器、关系规范化器和 Kinship Graph。以 Runtime ID 建边，保留来源，处理冲突并兼容旧档。

### Commit C：家庭事实 Prompt 补全
修改 Family Bundle、家庭事实构建器和 Prompt Builder。只注入目标相关事实，区分关系事实与人物知情状态。

每个提交必须附：
1. 修改文件与目的；
2. 修复前失败反例；
3. 新增测试和真实运行结果；
4. 源码 / 部署一致性；
5. 性能 / Token 对照；
6. 尚未完成的实机项；
7. 回滚方法。

---

## 10. 发布门槛与回滚

发布前全部满足：

- [ ] 年龄偏差定位到具体阶段。
- [ ] 有可信当前年龄时选择正确来源。
- [ ] 缺少可信年龄时不把未经验证的推算包装成确定事实。
- [ ] 日期边界、冲突、缓存更新测试通过。
- [ ] `otherParent` 转为有来源的亲子关系证据。
- [ ] 半兄弟姐妹的母亲可分别查询。
- [ ] 不生成两位母亲之间的虚假关系。
- [ ] 家庭事实 Prompt 能输出目标相关双亲信息。
- [ ] 未知 / 秘密关系不自动成为 NPC 已知事实。
- [ ] 不扩大 Memory 权限、不破坏 Forget / Campaign / Owner 隔离。
- [ ] 旧档兼容、Regenerate、Prompt、Token 和性能回归通过。
- [ ] 源码与部署文件一致。
- [ ] 真实 CK3 与真实 Provider 验收完成；未完成时必须明确标记 NOT_RUN，不得声称实机已修复。

回滚规则：
- 年龄修复导致回归时，回滚具体来源 / 日期适配改动，保留诊断和失败夹具。
- `otherParent` 导致关系误判或秘密泄露时，关闭派生边路径，保留原始字段和诊断。
- 性能退化时先回滚多余图遍历和 Prompt 注入，不得跳过权限、来源复验或秘密检查。
- 所有回滚保留 V9.3.6.3 的可复现测试。

---

## 11. 给 Codex 的施工指令

请在 `wsdsb-111/VOCT-NEW` 仓库中以 V9.3.6.3 当前代码为基线实施 V9.3.7。先检查分支、工作区、HEAD 和源码 / 部署映射，不要假定本方案的行号不变。

按顺序：
1. 建立年龄偏差与 `otherParent` 缺失边的失败夹具。
2. 增加匿名年龄分层诊断，定位偏差首次出现位置。
3. 根据证据修复年龄来源、亲属年龄覆盖或日期计算；禁止统一减一。
4. 将 `otherParent` 规范化为带来源的亲子关系证据并接入现有 Kinship Graph。
5. 扩展家庭事实块，使 NPC 在有依据且与问题相关时得到半兄弟姐妹双方母亲信息。
6. 区分关系事实、人物知情状态和 Memory 访问权限。
7. 完成单元、集成、权限、旧档、Prompt、Regenerate、Token 与性能回归。
8. 同步部署文件并验证一致性。
9. 输出变更摘要、测试命令和结果、性能对照、实机待验收项与回滚点。

不得只改提示词；不得假设 `otherParent` 已自动进入关系图；不得在没有诊断证据时直接改年龄算法；不得声称未运行的实机测试已经通过。

## 12. 最终目标

V9.3.7 的成功标准：

- 年龄事实可追溯、来源选择一致，证据不足时诚实降级。
- 亲子关系完整表达，半兄弟姐妹各自的母亲可准确查询。
- 关系事实与人物知情状态分离，补全家谱不泄露秘密。
- 当前对话只注入相关事实，保留 V9.3.6.3 的低延迟和低 Token 成本。
