# VOCT / VOTC V9.3.3.1 修复施工规格

> **状态**：待施工；本文是修复设计与验收清单，不代表问题已修复。  
> **仓库**：[`wsdsb-111/VOCT-NEW`](https://github.com/wsdsb-111/VOCT-NEW) · `main`  
> **锁定基线**：V9.3.3，commit `fc4f1c60a13b06d7daddac697e484db335f26647`  
> **目标版本**：Core / App / UI `9.3.3.1`；其他独立协议、Memory4 存储版本、Workshop、Official Action 版本不主动升级。  
> **变更类型**：严格限定的回归修复（CI + Coverage 来源关联 + Renderer 状态）。**禁止扩大为 V9.4 或重写 Durable Planner。**  
> **建议文件位置**：`docs/current/v9/V9_3_3_1_FIX_SPEC.md`  
> **核验时间**：2026-10-14，依据上述 GitHub 提交及其对应 Actions 运行记录。

---

## 0. 决策摘要与优先级

V9.3.3 已完成主要功能：Durable 全场排序、Legacy–Durable 只读来源可观测性、Year/Life 生产链与 UI 退役。但 Review 发现两个来源/UI 缺陷，以及一个**远端发布门禁阻断项**；须在继续 CK3 实机验证或 Year/Life 历史清理前处理。

| 编号 | 严重度 | 目标 | 现状/证据 | 验收出口 |
|---|---|---|---|---|
| FIX-01 | **P0（发布阻断）** | 干净 Windows checkout 的二进制资源/部署字节一致性 | [失败的 Release Regression](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/38503719487) 报 `build_deploy_initial_target_unknown:out/main/chunks/icon-BljXrxwL.ico` | 新 commit 的 push CI 完整执行并成功，不跳过部署或测试 |
| FIX-02 | **P1（覆盖统计可信度）** | 将 Legacy–Durable 的共享来源判定严格绑定同一 provenance | `memory4-coverage.js` 的 `sourceIntersects()` 使用分页内全局谱系列表与局部消息/片段 ID 交集 | 跨会话复用 ID 必须**不**显示 `SHARED_FRAGMENT_SOURCE`，同会话真实来源必须仍可关联 |
| FIX-03 | **P2（UI 分页）** | Coverage 明细展示用户实际选中的页 | 返回结果以 `coveragePages[summaryId][offset]` 保存，Renderer 却固定渲染 `[0]` | 41+ 事实翻到第二页显示正确不同记录，翻回第一页仍正常 |
| FIX-04 | **P2（UI 状态）** | Durable 详情跳转成功后正确清理 Loading | `showCoverageEntry()` 成功分支递增 `tabSelection.current`，`finally` 以旧值判断是否清理 | 跳转后无持续 Loading，且旧请求不得覆盖新会话/新 Tab |

**明确非目标**：改动每 Owner 8 条 Durable 硬上限、调整 P0/P1 关键词和时间分桶、修改 Legacy 摘要文案生成、重做 Coverage 产品形态、更新 Provider/GLM 缓存、修改 Action 逻辑、清空 Year/Life 玩家历史文件。

### 0.1 硬性数据与权限边界

1. `campaignToken × ownerId` 为最小隔离作用域；不可凭相同 `messageId`、`fragmentId`、人物名称、文本内容或同一页而确认来源关联。
2. 来源 proof、`knownBy`、`Forget`、`sourceRevision`、`indexRevision`、`bodyHash`、Legacy hash、`finalizationId` 验证不可放宽。
3. **没有证据时宁可显示 `RELATED_FINALIZATION_ONLY` / `UNVERIFIED`，也不能假装完整关联或语义一致。** 保留原有 `semanticEquivalence: NOT_ASSERTED`。
4. Coverage 是**只读数据**；不额外写入事实索引、不运行模型、不带来 API 费用；数据不必和 Legacy 文本逐条语义对应。
5. 本次禁止自动执行 `retire-year-life-v933.js --apply`，不删除任何玩家历史、存档、摘要、Durable、Recovery 或备份。
6. 改动必须兼容 V9.3.2 的已提交 `CAPPED` 和 V9.3.3 的 `coverageProof`；不触发历史 138 个 Owner 的重新付费提取。
7. 不允许为 CI 绿色而移除 `assertRuntimeInventory`、`seedInitialReceipt`、hash/parity/原子部署校验，或将失败测试标为跳过。

---

## 1. Phase 0 — 冻结基线与可复现故障

### 1.1 开工步骤

- 确认工作区、当前 `main` 的 HEAD 与 `fc4f1c60...` 一致；存在后续提交或未提交改动时先报告，不自动丢弃或覆盖。
- 阅读原始 V9.3.3 施工规格、实施/验证报告、[提交差异](https://github.com/wsdsb-111/VOCT-NEW/compare/d397f102d4222386e7f5424a340ac6a8cd444f25...fc4f1c60a13b06d7daddac697e484db335f26647) 和 `scripts/test-manifest.js`。
- 收集本地和 CI 的 Node 版本、Windows 版本、Git 版本、Git 属性以及目标图标的原始 SHA-256。只记录工具日志和资产哈希，不输出真实用户记忆正文。
- 为 FIX-02/03/04 **先新增能够在基线失败的复现测试**；不把“原测试 441/441 通过”当作已覆盖新情形的证明。

### 1.2 基线事实

CI 运行 `38503719487` 在 Windows / Node 22 下：

```text
Verify locked runtime dependencies     PASS
Build runtime from source               PASS
Verify runtime build (296 hashes)       PASS
Deploy runtime build                    FAIL
Run release regression                  SKIPPED

Error: build_deploy_initial_target_unknown:
out/main/chunks/icon-BljXrxwL.ico
```

**注意**：失败已被证实，但“`.gitattributes` 将 `.ico` 当文本执行行尾转换”仍是**待通过字节和属性检查确认的根因假设**，不能只凭扩展名直接下结论。

**Gate 0**：固定基线、失败签名、缺陷复现可重复；未做任何真实数据迁移或付费请求。

---

## 2. Phase 1 / FIX-01 — 修复干净 checkout 的 CI 部署资产

### 2.1 源码位置

- `.gitattributes`：当前存在 `resources/app/out/** text eol=crlf`，可能作用于二进制资源。
- `scripts/deploy-runtime-build.js:237–254`：`seedInitialReceipt()` 对每个受管资源比较**已跟踪目标文件**与**构建 staging 文件**，不匹配时 fail-closed。
- `scripts/build-runtime.js`、`scripts/verify-runtime-build.js`、`build/runtime-inputs.json`、`resources/app/out/main/chunks/icon-BljXrxwL.ico`。
- `.github/workflows/`：定位 Release Regression 使用的构建/部署步骤，沿用原步骤验证。

### 2.2 首先定位字节差异（不可跳过）

在一个新 checkout 上依次检查：

```bash
git status --short
git check-attr -a -- resources/app/out/main/chunks/icon-BljXrxwL.ico
git check-attr -a -- resources/app/out/main/main.js
node scripts/runtime-dependencies.js
node scripts/build-runtime.js
node scripts/verify-runtime-build.js
```

之后**以二进制 Buffer**读取：

- `HEAD:resources/app/out/main/chunks/icon-BljXrxwL.ico` 的 Git blob；
- checkout 后的 `resources/app/out/main/chunks/icon-BljXrxwL.ico`；
- staging 下对应的 `.build/runtime/app/out/main/chunks/icon-BljXrxwL.ico`。

输出三个 SHA-256、长度及首个差异字节位置。Windows PowerShell **不要**用会改变编码的普通文本重定向命令比较二进制；应使用 Node `Buffer`、Git binary stdout 或专门的哈希工具。

同时核对 `.ico` 真实内容与资源来源映射：若 blob/check-out 不一致，追查 Git 规范化；若 checkout/staging 不一致而 blob/check-out 一致，则继续检查生成器、资源清单或构建时原始输入，不能草率归罪 Git 属性。

### 2.3 修复策略

- **优先采用最小且系统性的 Git 属性修复**：将对 `resources/app/out/**` 的强制文本策略缩小为明确的文本类型（如 `.js`、`.json`、`.html`、`.css`），并确保 `.ico` 以及同目录其他真正二进制资产为 `-text`；如仍继承 `eol` 属性，显式清除该属性。
- 按 Git 属性覆盖优先级验证结果，而不是只凭配置文字判断；同时检查 `.png`、`.jpg`、`.webp`、`.wasm`、`.pak`、`.bin` 等已有受管二进制扩展名（遇到 LFS 指针还需校验 LFS 的独立合同）。
- 如文件在版本库中已被错误规范化，按原始可信构建输入恢复**真实二进制 bytes**，必要时做有限范围 `git add --renormalize`；不要全仓无差别换行或重编码。
- 保持已有文本 Prompt 和 frozen runtime source 字节要求；任何文字资源的 CRLF 变化都须解释并由现有 hash/parity 检测通过。
- 切勿为了绕过失败修改 `seedInitialReceipt()` 的 fail-closed 语义，也不要忽略 `.ico` 或跳过所有 `chunks` 文件。

### 2.4 CI 验收

在 **全新 Windows checkout（无先前 `.build`、部署 receipt 或残留输出）** 下执行 Release Regression 原工作流完整路径：

```bash
node scripts/runtime-dependencies.js
node scripts/build-runtime.js
node scripts/verify-runtime-build.js
node scripts/deploy-runtime-build.js
node scripts/verify-runtime-build.js --deployed
node scripts/test-release.js
```

成功标准：首次部署成功；资产 SHA 字节一致；296 项构建/部署校验继续通过或经清单核对后报告新的精确数量；release 回归整套运行并成功；**新 SHA 的 GitHub Actions `Release Regression` 必须结论为 `success`**。如果 CI 再现其他失败，保留精确日志并按新问题单独定位。

**Gate 1**：FIX-01 的干净 checkout 复现已消失，且本地 parity 与 CI parity 一致。注意最终推送后才能关闭“远端成功”这一 Gate。

---

## 3. Phase 2 / FIX-02 — Legacy–Durable 来源关联必须同源

### 3.1 故障机理

`src/app/main/memory-system/memory4-coverage.js`：

- `verifiedLegacyLineages()` 将当前批次 Legacy 的已验证谱系汇总。
- `sourceIntersects(legacy, entry, verifiedLineages)` 只要求某谱系与 Legacy/Detail 的局部消息、片段 ID 有交集。
- `classifyRows()` 将交集命中的 Detail 标记为 `SHARED_FRAGMENT_SOURCE`。

当前作用域内的**其他会话**可能复用 `sourceMessageIds` 或 `sourceSegmentIds`，而全局谱系列表不能作为当前两条记录属于同源的证明。这是统计错误风险；**尚未证明存在跨 Owner 的正文泄漏**，修复时也不允许把它描述成已证实泄密。

### 3.2 修复设计：身份元组 + 局部谱系 + 同源交集

对于每个 `(Legacy fact, Durable entry)` 候选，建立可验证来源身份元组：

```text
scope:             (campaignToken, ownerId)
conversation:      conversationId
finalization:      finalizationId
source lineage:    projectionId + verified message/segment/fragment linkage
revision:          current sourceRevision and eligible legacy hash
```

要求：

1. **先分组身份**：Legacy 所属 summary/fact 的当前 `finalizationId` 与 `conversationId`，必须和 Durable `entry.source.finalizationId` / `entry.source.conversationId` 一致；缺失、冲突时不得通过消息 ID 兜底。
2. **谱系按关联对象局部收集**：`verifiedLegacyLineages` 返回可追溯到当前 Legacy summary / fact 的信息（例如按 summary/fact 组织 Map），而不是让一页其他合法 Legacy 的谱系为当前比较“背书”。
3. **谱系本身必须属于相同 Owner / Campaign / Conversation / Finalization**，并且含有当前 Legacy fact 的合法 ID 或精确来源链；继续执行现有 `createProjectionLineage()`、Forget 校验、当前 source revision、Legacy fact hash 验证。
4. **最后才匹配消息和片段**：经以上身份门禁后，同一个可信谱系中的 source message ID 或 source segment ID 与 Durable 内源 ID 发生交集，才可返回 `SHARED_FRAGMENT_SOURCE`。
5. `LEGACY_SOURCE_EXACT` 的 `legacyRefs` + `sourceHash` 路径仍保持独立、严格，不能因本修复降级或放宽。相同内容、相同 `messageId`、相同 `fragmentId` 或同一批次列表，都不能构成精确证明。
6. 不确定情况按现有状态安全降级：`RELATED_FINALIZATION_ONLY`、`LEGACY_ONLY` 或 `UNVERIFIED`（根据已有证据和失败原因），禁止凭推测提升为已关联。**不要增加自动写回或模型二次推理。**
7. 保持 `durableOnlyCoverage()` 与 `provenSourceLinkedCount` 统计使用相同严格分类器；否则 UI 可能一边显示已关联，另一边又显示 Durable-only。

可选择函数改造：

```js
// 仅说明建议形状；最终以实际 schema 和 existing guards 为准
sourceIntersects({
  scope,
  legacyFact,
  legacySummary,
  durableEntry,
  verifiedLineagesForThisFact
})
```

内部必须**先核验身份、再核验来源交集**。不要单独新增一个宽松的 `messageIdsOverlap()` 布尔判断作为证据。

### 3.3 回归用例（必须先红后绿）

| 用例 | 期望 |
|---|---|
| 同一 Owner / Campaign，两场不同会话都使用 `messageId=7` 与相同 segment ID | 不出现虚假 `SHARED_FRAGMENT_SOURCE` |
| 同一页两条 Legacy summary，各自有合法谱系，事实 A 与 Durable A 不得借用事实 B 的谱系 | 不交叉认证 |
| 相同 `conversationId` 但不同 `finalizationId` | 不共享片段关联 |
| 相同 `finalizationId` 但不同 `conversationId` | 拒绝或 `UNVERIFIED`，不能误关联 |
| 不同 Owner、不同 Campaign、伪造 lineage | 拒绝，零私密正文泄露 |
| Legacy 来源被编辑导致 hash 变化、revision 过期、Forget 投影撤销 | 关联失效，不返回旧来源证据 |
| 同场合法消息交集、合法 fragment/segment 交集 | 返回 `SHARED_FRAGMENT_SOURCE` |
| 精确 `legacyRefs` 与 `sourceHash` 证据 | 仍返回 `LEGACY_SOURCE_EXACT` |
| 混合合法与不合法来源，Detail-only 统计 | 不能重复计数或误报“全覆盖” |
| 旧 V9.3.2 缺少完整来源信息 | 保持 UNKNOWN/保守分类，不伪造新的 proof |

建议扩展 `scripts/test-v9.3.3-memory4-coverage-ui.js`，同时补入 `scripts/test-v9.3.3-independent-qa.js` 的数据安全断言；名称可保留历史版本，只需在报告里说明是 V9.3.3.1 新增覆盖，避免为了命名破坏现有发布清单。

**Gate 2**：至少包含跨会话消息 ID 复用和同页谱系污染的失败复现，修复后全部转绿；旧精确关联、Forget、Owner、Campaign 检测仍通过。

---

## 4. Phase 3 / FIX-03 — Coverage 明细分页状态

### 4.1 已定位根因

`src/app/renderer/memory4-manager.js`：

```js
// 请求保存：
setCoveragePages(prev => ({
  ...prev,
  [summary.summaryId]: { ...(prev[summary.summaryId] || {}), [offset]: result }
}));

// 页面读取（错误）：
const page = coveragePages[summary.summaryId]?.[0];
```

当 offset 为 40、80 时，请求返回新页却仍展示 offset 0。此次修复必须同时管理**当前选中 offset** 和**已经缓存的页数据**。

### 4.2 建议改法

- 新增**按 summary ID 隔离**的 `activeCoverageOffset`（或等效 `currentCoveragePage` 状态）。
- UI 从 `coveragePages[summaryId]?.[activeCoverageOffset[summaryId] ?? 0]` 渲染，缓存不应决定哪一页处于激活态。
- 点击“下一页”：选择新的 offset → 先检查当前上下文和缓存有效性 → 有缓存立即显示对应页，否则请求该页；不能重新进入 `offset=0` 的“展开/收起”分支。
- 点击“上一页”：能够回到第一页，按钮禁用与页码标签、总数一致；尾页显示真实不足 40 项。
- 切换 Owner、Campaign、上下文、Legacy 版本、Forget generation、`summaryHash` 或 `indexRevision`，都必须清空对应缓存和 offset，防止旧数据闪回。
- 请求返回 `STALE` 时按现有逻辑刷新 Owner DTO，同时清空所有失效缓存及激活页；异步旧响应不能覆盖当前页。
- 收起再展开的预期行为须明确且测试：建议保留当前页 offset，但上下文失效后归零；产品若选择归零也可，但必须行为一致、无错误页。
- 不破坏 `limit <= 40`、只读来源查询、源码认证与已实现的读正文上限。

### 4.3 UI 测试

创建一份 **95 条可验证 Legacy fact** 的模拟摘要，覆盖 0–39、40–79、80–94，并使用真实渲染交互（或与生产组件一致的 React 事件级测试），验证：

1. 首次打开显示第 1 页且只显示 40 条；
2. 点击下一页后显示第 41 条开始，旧前 40 条不再显示；
3. 再下一页显示最后 15 条且“下一页”禁用；
4. 返回第一页使用正确缓存，源身份与对应的 Durable 详情按钮不串页；
5. 快速点下一页、返回、收起、切换 Legacy 摘要/Owner/Campaign，延迟旧响应不覆盖新的选择；
6. `STALE` 与 Forget 更改后，页缓存失效并重新认证。

现有 441 组测试不能代替此交互用例的验收。

**Gate 3**：页面按钮的真实行为与请求 offset、渲染 offset 一致；快切和旧响应没有错误显示。

---

## 5. Phase 4 / FIX-04 — Durable 跳转与 Loading 生命周期

### 5.1 已定位根因

`showCoverageEntry()` 在成功分支执行：

```js
setCoverageEntry(result.entry);
tabSelection.current++;
setTab("detail");
```

但 `finally` 仍以请求开始时的 `selection === tabSelection.current` 为清理条件。成功跳转主动使条件不成立，因此 `coverageLoading` 可能一直为 true。

### 5.2 修复约束

- 将**异步结果有效性**和**Loading 收尾**视为不同职责；禁止让主动成功导航使收尾条件失效。
- 实现可采用明确的 request token / active request ID，或者在确认成功且当前请求有效时**先将 Loading 复位，再更新 Tab**；但是必须同时处理 `throw`、`STALE`、组件 unmount、Owner/Campaign 更新与并发点击。
- 只有本次请求仍拥有 Loading 状态时才能关闭 Loading；旧请求的 `finally` 不应把新请求的 loading 错误清掉。
- 导航后的 `coverageEntry`、正文、按钮权限都应仍通过现有 `getMemory4Entry` 的 `expectedIndexRevision` / `expectedEntryRevision` / `expectedBodyHash` 校验。**不能为方便跳转直接在 Coverage DTO 中附加私密 Durable 正文。**
- 清理所有异常出口，包括 `STALE`、请求失败、用户在 loading 时切换页面；状态不能卡死。

### 5.3 UI 测试

- 从合法来源关联点击“查看 Durable”后：成功跳到 Detail，内容正确，`coverageLoading=false`，其他按钮可继续操作。
- `getMemory4Entry` 报 `STALE`：提示刷新、旧记录不显示、Loading 复位。
- 请求中切换 Tab/Owner/Campaign：旧响应丢弃，不能触发非法导航；Loading 属于当前上下文，不受旧请求篡改。
- 连续点击两个不同 Durable 记录：最终呈现最后一次有效选择的记录。
- 请求抛错与成功后立即刷新：无永久禁用按钮、无异常残留 Spinner。

**Gate 4**：成功导航和异常/失效/竞争条件全部通过，且没有削弱 Detail ACL。

---

## 6. 质量保障：不回退 V9.3.3 的关键能力

### 6.1 必须保留的正式合同

| 合同 | 不可回归结果 |
|---|---|
| Durable Planner | 8 条上限不变；早/中/晚事件优先级与身份、源顺序摘要、checksum 保留 |
| Durable Coverage proof | `authorized`、`screened`、`planned`、`modelEvaluated`、`unmodeled` 语义不变；旧统计无法验证则 UNKNOWN |
| Memory4 Store | 唯一结构化写入权威；不新建跨 Owner 来源缓存；不因 UI 请求写磁盘 |
| Recovery | 旧 V9.3.2 `CAPPED` 记录不自动重抽；9.3.3 新 checkpoint / Forget / revision 检验继续有效 |
| Legacy | 不改写原文、标题、投影关系；编辑、Forget 和来源撤销立即影响可观测性 |
| Year/Life | 已删除的生产服务和 UI 不得恢复；`YEAR`、`LIFE` 查询意图及即时 `conversation_year` 继续可用 |
| IPC / Preload | `memory4:getCoverage` 与 `memory4:getEntry` 的参数、安全校验与只读承诺保留 |
| Provider/Action | 不改 DeepSeek/GLM 请求、Prompt 锚点、Block ID 和 Action 派发状态；本版默认零付费请求 |

### 6.2 推荐测试执行（以仓库实际脚本和清单为准）

```bash
# 语法与局部修复用例
node --check src/app/main/memory-system/memory4-coverage.js
node --check src/app/renderer/memory4-manager.js
node scripts/test-v9.3.3-memory4-coverage-ui.js
node scripts/test-v9.3.3-independent-qa.js
node scripts/test-v9.3.3-evidence-planner.js
node scripts/test-v9.3.3-source-validity.js
node scripts/test-v9.3.2-independent-qa.js
node scripts/test-v9.2.3-derived-retirement.js

# 构建与全量门禁：必须在无残留资源的环境验证
node scripts/runtime-dependencies.js
node scripts/build-runtime.js
node scripts/verify-runtime-build.js
node scripts/deploy-runtime-build.js
node scripts/verify-runtime-build.js --deployed
node scripts/test-release.js

git diff --check
```

- 测试计数不能预设仍为 `441/441`：如果新加测试组，提交报告必须写实际数量，测试组未加入发布清单不算完成。
- CI 要求**新 SHA** 的 `Release Regression` 为 `success`，仅本地 release PASS 不够。
- 如果受环境约束无法跑干净 Windows 验证，明确标注 `BLOCKED`，不能将 Linux 上的模拟测试冒充目标 CI。
- 对源代码与 `resources/app/out` 实际部署产物做**双份逻辑一致性验证**：源码修了而运行产物仍旧是失败。
- 保留原有三主题 Electron 冒烟与 Memory4 1000 条数据、40 条分页性能的合同；有改动则核对截图和按钮状态。

### 6.3 人工验收（不以纯合成结果替代）

通过远端 CI 后，打开真实 VOTC UI 使用**测试存档/匿名数据**完成：

1. 查看多条 Legacy 来源映射；确认来源身份对应、不能串会话；
2. 查看长列表第二页，点击相关 Durable 并成功返回；
3. 进行 Legacy 编辑或 Forget，确认旧详情不能通过 stale 的缓存重新出现；
4. 确认仅剩“人物认知 / 官方追忆 / 详细长期记忆 / Legacy 对话摘要”四个页签；
5. 如有 CK3 连接，再做长会话一次，但本补丁不把它等同完整 Soak 验收。

**不得在本次 QA 中执行 Year/Life 历史数据物理清理。** 原有 28 Year + 11 Life 的历史清理应在版本修复、明确授权及计划 hash 复核后另行执行；保留原迁移工具与回滚机制。

---

## 7. 施工阶段、交付物和停止条件

| 阶段 | 交付物 | 放行条件 |
|---|---|---|
| Phase 0 | 基线记录、4 个问题的独立复现/定位日志 | 不污染用户数据；缺陷复现可信 |
| Phase 1 | `.gitattributes` / 必要资产规范化修复，干净 checkout 部署证据 | 失败 `.ico` SHA 问题解决；部署校验仍严格 |
| Phase 2 | 同源 Provenance 约束 + 负例/正例安全回归 | 跨会话来源不能借证，合法映射不退化 |
| Phase 3 | Coverage 激活 offset 状态 + 真实交互分页测试 | 第二页/尾页/返回页正确，无 stale 泄漏 |
| Phase 4 | Detail 导航 Loading 生命周期修复 + 竞争测试 | 成功或失败均能回到正确加载状态 |
| Phase 5 | 全量构建、release、Electron、干净 Windows、远端 CI | 新 SHA `success`；所有日志可复核 |

### 7.1 必交文件（建议）

- `docs/current/v9/V9_3_3_1_FIX_REPORT.md`：按 FIX-01..04 报告根因、修改文件、复现方式及前后结果。
- `docs/current/v9/V9_3_3_1_VERIFICATION_REPORT.md`：测试命令、PASS/FAIL 数、构建 SHA、部署资产 hash 和新 commit CI URL / 结果。
- `docs/current/v9/V9_3_3_1_CHANGED_FILES.md`：实际改动清单和未更改的安全边界。
- 如 CI root cause 是 `.gitattributes`，补充 Git blob / checkout / build staging 三方 bytes hash 对照；不记录玩家数据。
- 版本号在实际发布入口与构建产物同步为 `9.3.3.1`，不擅自升级对外记忆 schema。

### 7.2 明确禁止的捷径

- 禁止关掉 CI workflow、跳过失败步骤、`continue-on-error`、硬编码 `success` 或删掉资产检查。
- 禁止把所有 lineage 合并成更宽松的「同一场」判断来快速修好 UI 数字。
- 禁止修改 Durable 重要性评分、扩大 8 条上限、替换 Provider、改变 Memory4 的事实权威存储。
- 禁止用“44X tests PASS”代替显式的第二页 UI 交互和跨会话复用 ID 负例。
- 禁止自动推送、重写 main 历史或删除用户 Year/Life 文件；提交、推送和迁移应用按用户明确安排执行。

### 7.3 最终完成定义（DoD）

只有以下条件**同时满足**，才可称为 `V9.3.3.1 修复完成且远端门禁通过`：

- [ ] 四个 FIX 的旧版失败复现已记录，修复后通过。
- [ ] clean checkout 二进制资源与 staging 字节一致，没有放宽 hash/parity 审计。
- [ ] Legacy–Durable 只在相同可证实来源身份下建立交集，跨会话 ID 重复不误关联。
- [ ] Coverage 明细分页第二页、最后一页、返回第一页均显示正确记录。
- [ ] 查看 Durable 成功导航后 Loading 复位；异常和旧请求不会污染当前页面。
- [ ] 完整 release、回归测试、部署产物、三主题 Electron 冒烟通过。
- [ ] 新 SHA 的 GitHub Actions `Release Regression` 运行结论为 `success`，并记录链接。
- [ ] Legacy/Durable/Forget/Recovery/Year-LIFE 退役行为无退化；未执行历史文件清理和付费重提取。
- [ ] 交付报告清楚区分自动化、CI 与未完成的 CK3 实机/Soak Gate。

---

## 8. 可直接交给 Codex 的执行指令

> 在 `wsdsb-111/VOCT-NEW` 当前 main 上实施 `docs/current/v9/V9_3_3_1_FIX_SPEC.md`，锁定 V9.3.3 基线 `fc4f1c60a13b06d7daddac697e484db335f26647`。本次仅修 FIX-01..04：CI 图标二进制部署一致性、Coverage 跨会话来源误关联、Coverage 明细分页、Durable 详情跳转后的 Loading 清理。先复现后修改，保持所有 Memory4 证据/Forget/Scope/Revision/8 条上限不变。严禁关闭部署校验、自动付费请求和执行 Year/Life 数据清理。按 Phase Gate 分段实现，提交完整验证报告和干净 Windows Actions 证据；如暂不能获得 push 后 CI success，明确报告未完成并停止宣布放行。未经用户要求不自动推送。

---

**本次补丁的原则**：只修已证实或有可复现路径的四项问题，确保 CI 可信、Coverage 的“已关联”可信、玩家 UI 的分页与导航可信；将 CK3 长期质量和 Year/Life 历史数据迁移留给独立验收。
