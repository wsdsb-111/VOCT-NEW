# V9.2.3 候选验证

2026-10-12～13，北京时间。基线 `071f62b73d27cf4bd37309e5e836335f914c174d`；源码及原生证据候选 C6 `202f98ced8e26373035c5b0b7ee53194b8789e07`，C1～C6已分包提交，C7仅补齐文档和验证索引。最终文档提交的 SHA 与远端 CI 在交付回执独立核验，不借旧CI结果。正式 App9.2.0／UI V9.2，未签 Full Freeze。

施工方案仓库归档仅去除5行Markdown行尾空格，下载原件未修改，原件SHA256 `8e74ea87b459efd2d324058cd3c4e7d7917ec2d4c205c0ccef1abe7885c41d5a`；运行时Prompt字节未因此变动。匿名机器索引见[验证证据](v9.2.3-verification-evidence.json)。

| 项目 | 结果与证据范围 |
|---|---|
| 备份与用户数据 | PASS：3877文件／616403261字节；复核changed=0/new=0；579代码文件逐字节备份 |
| 依赖锁 | PASS：5981文件／264包，无vendor升级 |
| 资源一致性 | PASS：287映射；R5 payload `5c20f6c789af82bd473d79db40d809cc2ed56e7112c54376669ab2d761c4ec05`，回执COMPLETED |
| 退役专项 | 旧版3 PASS/5 FAIL → 候选8 PASS/0 FAIL；网络0 |
| Recovery专项 | 旧版3 PASS/5 FAIL → 候选8 PASS/0 FAIL；真实原子夹具，无复制删除替代 |
| 信件退役状态独立QA | PASS：完整skip完成；残缺持久proof或非法DTO不能短路；Durable失败仍失败，已提交Detail不重复提取 |
| 生命周期/Trace独立QA | 12 PASS/0 FAIL/5 ARCHIVED；权限、手改、Forget、Journal、Planner、Legacy保留 |
| GLM离线wire/client | PASS：3版本101场景一致，96参数矩阵；SDK mock、网络0 |
| GLM usage | PASS：3×4夹具覆盖零值、UNKNOWN、reasoning、usage-only尾块 |
| V9.2.2发送前Forget | PASS：旧保护保留，Durable未停用 |
| 实际退役打包窗口 | PASS：3主题×2视图；3个rebuild IPC零Provider、旧档手改，网络禁止 |
| 常规打包窗口 | PASS：诊断OFF/ON、版本、Presence、Memory4 fail-closed审计、改名目录及日期顺序 |
| 测试清单 | PASS：499文件分类、427 release组、71整组历史检查；混合ARCHIVED不算PASS |
| 完整release | PASS：427/427，正式完整一轮；此前失败及剩余291组诊断分别保留，诊断不冒充完整PASS |
| GLM原生实验 | EXECUTED：128/128原生usage完整、无失败/UNKNOWN，合并费用上界¥0.666378，¥10硬限 |
| 当前SHA远端CI | 交付时按最终文档提交SHA核验[Release Regression](https://github.com/wsdsb-111/VOCT-NEW/actions/workflows/regression.yml)；本报告不预设成功，最终回执保留实际run/sha/conclusion |
| CK3人工/Soak | NOT_VERIFIED：三人、重复开启、跨年代召回、Forget、动作/信件与新窗口费用 |

离线wire SHA256 `ba2d3b15f473c9b14cb8e2a8d0970e1a6beec708a3b047854015c6864a16197d`；client `085cf071a493281901dd7058b745767d4c68266649a3470df63af0bb71464c59`；usage `56a9c120bc9b334e2eadec8a75297abf3c97c55ffc1ee2fbc6f27bfb4473d747`。本地输入档位是估算，原生按实际prompt_tokens分箱。

完整RED套件结果保留于施工执行记录，未落盘；不能以仅含一条模拟调用的 `.build/v923-cost-red.log` 冒充完整两套RED日志。当前GREEN日志为 `.build/v923-final-retirement.log`、`.build/v923-final-recovery.log`。

## 原生费用与边界

逐次usage、分类、参数、费用账本哈希与限制见[原生匿名证据](v9.2.3-glm-native-evidence.json)；只导出白名单数字、枚举及哈希，不包含Prompt/回复正文、用户身份、原始请求ID或凭据。

本轮官方[价格Markdown](https://docs.bigmodel.cn/cn/guide/start/pricing.md)核验GLM-5.3-Flash输入0.8/输出2.8/命中0.23元每百万Token、缓存存储限时免费，源文SHA256 `2b20b4b2ef10879ad0bebee610128e0f49df02d4602fd2c64e09964dccb6d68b6`。单请求预留 `(实际JSON UTF8字节+4096)×2.8/百万×1.5`；UNKNOWN/失败保留全额，无隐式重试，128尝试/10元双硬限。估算账本与供应商账单分开。

保留现有模型及官方端点、stream=true、thinking enabled、reasoning high、clear_thinking=true、temperature0.7、max_tokens4096、应用cap90000。本地2026-10-13 00:27:45～00:40:18完成125次（A核心40、2K/35K扩展40、B三NPC交错15、C日期变化10、D短/长间隔20），NOT_EXERCISED=0。完整usage125、HTTP200为125、原生零值14、非零111、UNKNOWN/失败0；费用上界¥0.648401，未占用预留0，未核验供应商结算账单。

原生A实际输入：2K档1682～2987、15K档14211～15526、25K档23167～24472、35K档32610～33915。14个独立批首请求零，之后111/111暖候选均非零，没有COMPARABLE_PROVIDER_ZERO；全体TTFT p50 843.03ms/p95 2090.33ms。所有finish=stop；严格JSON质量108 PASS/17 FAIL，在可解析108次中scope/owner均PASS。质量失败不重发、不当作请求失败或缓存UNKNOWN，合成结果不代表真实RP质量。

D组内同body，短/长组有不同独立cohort前缀，不能把组间当同body TTL对照；组内间隔中位2011ms/60010ms，长组60秒后仍命中。2秒/60秒为显式实验假设，不推断供应商TTL。

为补齐完全同Prompt间隔比较，在同轮预算和128次数硬限内另执行3次：与原D-long完全相同body/参数，距上次同body完成1105571ms时报告0，完成后2015ms及60011ms的两次都命中13696。该零值有精确同body前件，是可比供应商零值，缓存驻留未知；不能因补充首条就断定是新前缀冷请求，也不能推断真实TTL。补充原生usage/HTTP200均完整，质量2 PASS/1 FAIL。

合并128次：15次零、113次非零、usage完整128、失败/UNKNOWN0、严格质量110 PASS/18 FAIL，费用公开费率估算上界¥0.666378、未占用预留0。原125和补充3的账本分别保留，原始哈希不改写；小样本对照不代表真实长局收益。

真实窗口19个原生零与7个UNKNOWN已区分，13次同Owner可比稳定前缀仍为零。旧/新/候选应用出站等价，未证明app regression，未改v813或参数。即使合成高命中，也不能代表真实生产长局已恢复；GLM收益HOLD。

G0通过；G1/G2/G3/G4自动化与真实CK3分开。G7/G8未全齐不升级正式版本，不自动展开V9.3。人工后续核验Year/Life请求/输入/输出全0、Durable完成率、Detail/Legacy事实与Forget，记录新SHA及独立时间窗，不重放未知效果。
