# V9.3.7 CK3 实机验收清单

状态：最终源码已冻结；build/deploy/parity 290 mappings、正式性能对照、Pair benchmark、11 组隔离 Electron smoke 和完整 release regression 通过。Release 为 442/442 groups，manifest 为 442 release groups／127 archived entries。用户要求停止后续测试；最终 wrapper 的额外 deployed-parity 阶段未重跑，构建报告已有 deployed parity PASS。合成生产 Prompt Provider 复核为 PARTIAL。真实 CK3、游戏内 Provider、Soak 与远端 CI 尚未执行。

## 当前本地证据

- 最终 payload：`05871d99e3b52e1442b322129ab17ccc2ea367ec259409b122f7d0f2929709da`，290 mappings；`.build/v937-final-build.log`、`.build/v937-build-report.json`。
- 完整 release regression：`.build/v937-release-final-candidate.log`，最终 **PASS 442 groups**；实际 manifest 为 442 release groups／127 archived entries。
- 正式性能每臂 20 warm-up／30 samples：普通 P95 baseline `0.3732 ms`、candidate `0.3233 ms`；普通 Prompt `2857→2857` tokens；母亲查询家庭块 delta `-79`、step 查询 `-7`。10% 阈值不变；不将子毫秒差异外推为普遍提速。`.build/v937-perf-comparison.json`。
- Pair benchmark：22 cells／484 calls、0 gate failures、`completed=true`；使用历史命名的当前源码 harness，5 个核心检索文件 hash 与 retained baseline 一致。`.build/v937-pair-benchmark-raw.json`、`.build/v937-pair-benchmark.log`。
- 最终候选双启动 Electron smoke：11 groups，版本 9.3.7，网络／Provider calls 为 0，进程已关闭。`.build/v937-full-ui-visual-smoke-LdVnLy/offline-native/smoke-evidence.json`、`integrated-qa.json`。
- 合成 DeepSeek 生产 Prompt 共 26 次，本轮复核已结束。最终 parity 为 18 个 Prompt hash 相同、8 个旧阶段 superseded。最终未知 3 例中 2 例明确不知道但补入无来源背景，1 例回避回答且未编造身份或否定关系（人工标记 `ABSTAINED_WITHOUT_IDENTITY`）；literal FAIL 与两例旧模型错答保留，整体 PARTIAL。具体结果和预算口径见[实施报告](V9_3_7_IMPLEMENTATION_REPORT.md)。
- 历史红测与失败记录不删除：`.build/v937-red-age-baseline.log`、`.build/v937-red-parent-baseline.log`、`.build/v937-perf-expanded-first-failure.json`。完整 release 曾发现旧 `v8.12-temporal-archive` 年龄断言过时；修正测试期望后年龄专项通过，当前最终 release 仍运行中。

## 准备与日志导出

- [ ] 用更新后的 Workshop 模组启动 CK3，确认实际加载目标 `log_character_v2_effect.txt`。
- [ ] 重新导出人物日志；核对 `parents` 索引 5／6／7 的年龄、代词、公开父母标记，`kids`／`siblings` 的新年龄字段，以及 `otherParent`、`parent_spouse/currentlegalmarriage`、`parent_spouse_child` 的字段来源和完整公开双亲条件。
- [ ] 验证当前婚姻 producer 的 `is_alive=yes` 保护与游戏内当前婚姻事实一致；记录游戏／模组版本、日期和匿名化证据，存入 `.build`。
- [ ] 用更新前旧日志确认缺字段仍为 UNKNOWN，不会猜测或自动回填。CK3 重导出之前不得把新字段视为可用。

## 年龄、双亲与半兄弟姐妹

- [ ] 可信 CK3 当前年龄优先于 Gregorian 推算；只有未验证推算或缺失／冲突来源时保持未知。
- [ ] 至少测完整人物、仅在亲属记录中的场外子女和生日边界人物；对照 CK3 日期、界面年龄、日志字段、来源绑定与最终 Prompt。
- [ ] 以真实家庭验证同父异母与同母异父关系、父母交集和来源绑定；不同母亲／父亲之间不得生成夫妻或无来源亲属边。
- [ ] 未知、秘密、来源缺失、多人口歧义不进入 NPC 家庭事实视图，也不应被描述为 NPC 已知。

## 当前继亲、未知与历史来源

- [ ] 当前继父／继母与继兄弟姐妹只由来源绑定的当前公开婚姻及完整公开双亲资料构造。
- [ ] 父母、raw spouse 或 canonical spouse 明确 DEAD，或生命状态冲突时不得输出 CURRENT step-family；父亲死亡但留有旧 spouse row 的反例应保持无当前继母事实。
- [ ] 生命状态缺失时只接受新鲜、来源绑定的 `CURRENT_MARRIAGE`，不假定人物存活。
- [ ] UNKNOWN 不得回答为“没有”，也不得补造父母生死、婚史或当事人不知情的原因；“当前游戏资料未确认”不能否定有来源的过去关系。
- [ ] 有明确来源且带日期的历史 Legacy 继亲记录继续按原 Owner／Campaign／Forget 权限可见；不增加 Memory 读取，不因当前 GameData 缺项而把过去关系判不存在。
- [ ] 严格 typed STEP 保持读取兼容；不从前配偶关系推断历史继亲。当前 CK3 没有可证实的历史婚姻区间 producer，不自动重建历史。
- [ ] 验证 regenerate、来源变化、Forget、跨 Owner／Campaign 和多人歧义继续保持隔离。

## 真实 Provider 与发布 Gate

- [ ] 在真实 CK3 场景用真实 Provider 验证年龄、半兄弟姐妹、当前继亲、未知与明确来源历史关系；记录最终 Prompt 事实、回答与差异。
- [ ] Prompt 正确而模型回答错误时记录 `MODEL_ANSWER_MISMATCH`；不得用一次失败推翻结构化来源边界。
- [x] 核对 `.build/v937-release-final-candidate.log`：完整 release regression PASS 442/442，manifest 为 442 release groups／127 archived entries。
- [ ] 单独记录 Soak 与远端 CI；未执行项保持 NOT_RUN。

## 当前 Gate 状态

| Gate | 状态 | 证据／备注 |
|---|---|---|
| 最终源码 build/deploy/parity | PASS | 290 mappings；payload `05871d99e3b52e1442b322129ab17ccc2ea367ec259409b122f7d0f2929709da` |
| Node 22 性能／Prompt | PASS | P95 `0.3732→0.3233 ms`；Prompt `2857→2857`；家庭块 `-79／-7`；不外推为普遍提速 |
| Pair 检索 benchmark | PASS | 22 cells／484 calls，0 gate failures |
| 隔离 Electron 双启动 | PASS | 11 groups；network／Provider calls 0；进程已关闭 |
| 完整 release regression | PASS | `.build/v937-release-final-candidate.log`；442/442 groups，442 release groups／127 archived entries |
| 合成生产 Prompt Provider | PARTIAL | 26 calls；18 hash 相同／8 superseded；未知修后 2/3 明确表示不知但补叙背景，1/3 回避回答，literal FAIL 与旧错答保留 |
| CK3 加载与真实存档 | NOT_RUN | 新脚本尚未由本清单确认实机加载及重新导出 |
| 游戏内 Provider | NOT_RUN | 合成 Prompt 调用不等同于真实 CK3 对话 |
| Soak／远端 CI | NOT_RUN | 分别执行并签署 |
