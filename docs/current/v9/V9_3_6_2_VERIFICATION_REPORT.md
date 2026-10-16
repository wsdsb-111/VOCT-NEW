# V9.3.6.2 验证报告

状态：本地发布候选验证通过，2026-10-16；不代表Full Freeze。需求见 [施工规格](V9_3_6_2_OPTIMIZATION_DEVELOPMENT_SPEC.md)，实现见 [实施报告](V9_3_6_2_IMPLEMENTATION_REPORT.md)。

## 本轮重新验证的基线

起点 `fbe8cc3fc1abc45c6e41bb6ba16bc00e0dc46c54`，修改前工作树干净。在隔离 Windows 副本中重新执行 runtime-dependencies、build、verify、deploy、verify --deployed 和 test-release，六步退出均为 0，422／422 发布组通过。288 项映射，68 个 LFS 资产逐一校验；Node v22.23.3。日志 `.build/v9362-baseline-*.log`，位置 `.build/v9362-baseline-location.json`。这是本轮重新运行的成绩。

## 反例与修复验证

- GLM 新实例旧默认 Auto 的红例已复现；新 Main／Renderer Custom90000 与旧 Auto 保留的真实 SettingsRepository／IPC fixture 通过。
- “玛蒂尔达后来怎么样了”原先错误 L0，分句修复后真实 MemoryEngine／PairLedger 召回通过。混合否定 C 与历史 D、旧 C 焦点代词冲突、引述和无可信轮次已纳入专项。
- 64 Pair 独立 fixture 从旧全量 scope 缩至 4，最终事项、顺序、source key／revision 与 exhaustive reference 相同。Owner／Campaign、合并投影、其他 Owner 私有资料和来源失效分别检查。
- 独立 QA 覆盖新增、同尺寸同 mtime 改写、删除、Forget、别名唯一性、场景／日期变化、确认、Legacy 歧义和不完整快照回退；构建后、候选读取后和最终校验时注入竞争均丢弃整轮结果。L2 失败与 fallback 总尝试不超过 2。
- 256-token 的空输入估算曾出现 `0 <= 0` 误报可发送，现改为必须有正的可用输入空间；真实预算、1M 记忆 cap、只读 diagnostics 和 UsageAnalytics 隐私投影专项通过。

最终完整 Release 会重新覆盖全部专项，以上定向结果不替代最终门禁。性能不引用旧版旧机器成绩；[A/B 报告](V9_3_6_2_PAIR_PERFORMANCE_AB.md)记录本轮数据。

## 最终构建与发布门禁

运行代码终点 SHA：`abb5f9ce086a1da850b4aba78a7e429ac0cf27ae`。全新Windows验证快照 `bbbace1b0f88ce3e67cf8fc87f6c55cb323f08d5`，初始无.build，core.autocrlf=true，68个LFS资产逐个核验。最终运行payload `0445d6388410f7519f4083c2bcdd8bed43dad3b4a24d1d4336f9823fab15b5e6`；289项映射在根部署和全新候选完全一致。后续文档收口不改payload。

| 标准步骤 | 退出码 | 结果 |
|---|---:|---|
| scripts/runtime-dependencies.js | 0 | PASS |
| scripts/build-runtime.js | 0 | PASS |
| scripts/verify-runtime-build.js | 0 | PASS |
| scripts/deploy-runtime-build.js | 0 | PASS |
| scripts/verify-runtime-build.js --deployed | 0 | PASS |
| scripts/test-release.js | 0 | 427/427组，555测试文件分类 |

日志 `.build/v9362-candidate-*.log`，聚合 `.build/v9362-clean-candidate-report.json`；完整输出明确含 Release Regression PASS。日志末尾部分letter/log-reader fixture的预期负面错误不是发布失败。唯一清单当前555 test文件、427发布组及127历史项。

最终专项：context兼容、16／16真实Engine意图矩阵、10组独立candidate QA、Provider预算／匿名遥测、23项轻量oracle均退出0；正式1080个候选性能样本、24格门槛通过，构建次数补充审计32格／64次调用通过。既有V9.3.6.1意图、context、scale、Recent去重、Responder预算及V9.3.6独立QA均在完整门禁中继续通过。

独立link回归中Owner目录junction及批量读取中新增junction实测通过；此主机不能创建普通文件symlink，因此该子项仅静态核对实际lstat拒绝guard，未声称完成文件symlink实测。safe→exhaustive→safe实测保留事项顺序、scope和source key/revision，切换使快照失效，回safe后重建目录。

旧V9.3.6.1原始288项构建、逐项部署哈希及原receipt保留于 `.build/v9362-preserved-v9361-runtime`；新部署备份事务 `61493e71-9d39-4934-828c-3dff7e417a64`。只保存运行资源，无真实APPDATA。7个交付模块语法、当前文档链接和git diff --check已通过，最终文档收口后另做链接复核。

## 隔离窗口与实机边界

PASS：实际 VOTC.exe 的一次性 APPDATA／LOCALAPPDATA／USERPROFILE 窗口及同profile重启，验证新GLM为未验证Custom90000、已有Auto重启保持、显式兼容按钮、1M Custom、非法输入未落盘和非法IPC拒绝、256零输入预算警告与真实diagnostics IPC。部署Engine的L0／L1／L2来源数为0／0／2，冻结字节不变，实际格式化记忆1410≤4800。Core／App／UI／窗口均9.3.6.2，加载模块哈希与源／部署一致；已检查90K、Auto选项和小窗口三张截图，文字及按钮可见。两个测试窗口均正常退出，网络与生成调用均0。[匿名证据](v9362-native-evidence.json)，本地位置 `.build/v9362-native-location.json`。

冒烟脚本初轮的服务商名称定位、懒加载校验时机、Auto清理无效Custom值的假设、重启重复seed导致来源身份歧义均已纠正；这些是隔离脚本问题，未改生产代码来迁就断言。最终双启动退出码0，使用同一运行payload。

真实 Provider、CK3、20–30 轮联调、80–100 轮 Soak 和远端 CI：**NOT_RUN**。本轮付费调用 0，未推送，不以合成 fixture 或一次隔离窗口代替以上验收，不宣称 Full Freeze。

最终文档收口复核：7个交付模块语法通过，804个当前文档本地链接通过，git diff --check通过；本地部署289项哈希再次核验通过。运行代码SHA见上文，后续报告提交不更改运行payload。
