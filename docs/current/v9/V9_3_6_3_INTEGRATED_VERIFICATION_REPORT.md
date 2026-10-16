# V9.3.6.3 综合验证报告

状态：2026-10-17本地候选完整回归、构建部署、隔离窗口与性能A/B通过；不代表Full Freeze。干净Windows候选六步复验已通过；测试代码提交 `b4a9e805231fffea82b4c8d6f09d56a1d7610a08`，此后的收口只更新文档。

## 环境与冻结

Windows 10.0.26200，构建/发布测试Node22.23.3；实际VOTC壳为Electron35.1.5、Node22.14.0、Chromium134.0.6998.179。App/Core/UI仍为9.3.6.3，复用原Windows壳。289项映射及源码/构建/部署一致，payload `8a706fd7ab2cfb507c0f8ae52c437758c3fb42c98d950febcf56862b57e82a10`；独占采样前后[源码哈希](v9363i-source-evidence.json)一致。

冻结前置基线 `5c6af27e4f502b8c2a6dfb93dc8a03dd989d5092` / payload `4a5a54504815a3482450d5e6d53c269c988759fe06619a8dc38bafbccea91673`，原289项资源和部署回执保存在忽略目录.build/v9363i-preserved-runtime；合成基线310次完成，未读写真实APPDATA。此前TwoP1报告的430组/9116次属于旧批次。

## 实际执行

| 门禁 | 结果 | 证据范围 |
|---|---|---|
| runtime-dependencies/build/verify/deploy/verify --deployed | PASS | 5981文件/264依赖包；289源码/运行资源映射 |
| scripts/test-release.js | PASS | 436/436组，六个新增专项已登记唯一manifest |
| AGE-01 | PASS | A01–A14，CK3当前17与生日推算18冲突时保留17；生日、死亡、未知和来源约束 |
| 时间与亲属 | PASS | 20项；去年/明确年份/模糊扩展、双子歧义、预算、事件年与谈话年隔离 |
| REGEN窄回归 | PASS | 六组；原玩家锚、ID、场景、旧轮、错误重试和动作副作用尾部 |
| 独立集成QA | PASS | 九组；真实MemoryEngine/Store/PairLedger/Conversation/Prompt，合成transport |
| 实际重新生成Prompt | PASS | 两位Owner各首次+五次regen，共12次发送；逐次独立重算最终记忆块hash一致 |
| 来源竞争与确认 | PASS | T13身份/亲属/Campaign/Scene，T14同size/mtime改写、Forget、preview/apply及撤回 |
| OBS匿名对照 | PASS | 选择/来源/实际注入digest、逻辑轮/物理尝试、年龄冲突、统计与既有导出入口白名单 |
| 隔离打包窗口 | PASS | 两次启动且进程已关闭；实际部署模块九组QA、实际版本/Preload/Renderer、Legacy文件夹 |
| 本轮独占A/B | PASS | 22格/484次；每格A1cold、B1cold+20warm |

[性能明细](V9_3_6_3_PAIR_AB_REPORT.md)、[匿名窗口证据](v9363i-native-evidence.json)、[实施报告](V9_3_6_3_INTEGRATED_IMPLEMENTATION_REPORT.md)。水墨主题展开事项截图已目视核对姓名、日期对齐和折叠来源；截图仅留在忽略的.build隔离夹具，不提交。UI截图不代替年龄/召回的Prompt断言。

## 反例与修复迭代

年龄红例与时间授权红例先在原路径复现，保留于.build/v9363i-age-red-final.txt及v9363i-temporal-red.log。独立QA随后发现单字真名丢失和确认事项后dynamic缓存未失效，已用真实PairLedger及最终Prompt验证修复。只读复审发现事件轴与谈话轴混用、摘要级事件窗误配其他事项，已改为当前已确认事项本地锚，并加入同摘要1190叛乱/1199婚礼的反例。

旧回归夹具补齐CK3年龄来源、真实轮次管理器和新的来源枚举；没有放宽生产授权。施工中一次构建资源核对遇到并行源变化，该不完整运行不计PASS；最终构建与完整436组回归均在冻结源上顺序执行。旧窗口夹具问1090年却没有该年来源，补合成记录后重跑通过，没有修改生产时间过滤。

## 外部验收边界

真实CK3存档/日历与生日、真实Provider与模型grounding、20–30轮联调、80–100轮Soak、远端CI均为NOT_RUN。合成请求、静态通过或Prompt注入一致不等于模型回答已验证。付费调用0、成本0；不推送远端、不改变真实摘要/凭据/存档。操作项见[实机清单](V9_3_6_3_REAL_GAME_CHECKLIST.md)。

## 干净Windows候选与最终交付

从本地提交 `b4a9e805231fffea82b4c8d6f09d56a1d7610a08` 创建无.build目录的新克隆；68项LFS原始资产逐项SHA-256校验。Node22.23.3顺序执行 runtime-dependencies、build-runtime、verify-runtime-build、deploy-runtime-build、verify-runtime-build --deployed、test-release，六步全部退出0，完整436组再次通过。289项映射及payload与主目录一致：`8a706fd7ab2cfb507c0f8ae52c437758c3fb42c98d950febcf56862b57e82a10`。匿名[候选证据](v9363i-clean-candidate-evidence.json)保留实际命令与结果。

运行代码已本地提交，报告收口不改变源码/运行资源；没有推送远端。真实CK3、Provider、联调、Soak与CI仍为NOT_RUN。
