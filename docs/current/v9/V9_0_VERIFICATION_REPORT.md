# V9.0 实施与验证记录

日期：2026-10-11；本地工程验证LOCAL_PASS，远端／现场Gate为HOLD。冻结基线3c49364，工作分支codex/v9.0-engineering-baseline，V9修改未提交／未推送。

当前发行版本已按用户后续要求对齐：项目 V9.0／核心 9.0／App 包 9.0.0／VOTC Workshop Mod 2.0.5；前端与主题预览同步。Memory Engine 4.0、协议 3.0、摘要存储 2.5、Official Action 2.0.3 和独立 Three-Mod 1.0.6 保持。最新验证与文件指纹见[版本对齐](V9_VERSION_ALIGNMENT.md)，下方工程证据为版本对齐前的阶段快照。

版本对齐后最终原始完整门禁 **409/409 PASS、exit 0**；实际隔离 App 两进程的包版本／标题／页脚／提示读回通过，默认关闭截图人工核验。两份 Workshop descriptor 为 2.0.5，七份 Bridge 哈希未变；35 份源码／测试／当前文档指纹与日志哈希见[最新版本证据](version-alignment-evidence.json)。未上传，不签发远端 CI 或真实 CK3／Provider PASS。

| 包 | 本轮已执行 | 状态 |
| --- | --- | --- |
| WP-00 | 干净HEAD核验、7079资产/68LFS、3536用户文件、7Bridge、13安装Mod私有备份及哈希；V8原始409/409 | LOCAL_PASS |
| WP-01 | checkout新增fetch-depth0；浅clone缺fda1b8e为RED，同副本unshallow后对象可读；旧业务负例保留 | LOCAL_PASS，CI_PENDING |
| WP-02 | 默认关闭／有限脱敏trace、IPC、Renderer诊断；专项及真实隔离exe关闭／开启／导出通过 | LOCAL_PASS，CK3_USER_GATE_PENDING／PROVIDER_PENDING |
| WP-03 | 13源码／3QA／3手工补丁独立导出与19项hash、干净副本3/3绿、缺文件负例；旧副本及三release项移除 | LOCAL_PASS，独立CI_PENDING／CK3_PENDING |
| WP-04 | 路线/规格、真实架构、数据责任、退役台账与12项行为合同映射入库；当前文档本地链接通过 | LOCAL_PASS |

本地专项：CI-history、performance-trace、独立diagnostics QA、DATE incremental、receipt-startup、summary-incident recovery和single-instance-storage-safety均通过；12个新增／修改JS语法通过。Manifest目前478分类文件／409发布组／68历史归档，迁出3组并新增3组。首次完整门禁在summary-incident recovery发现诊断count求值读取缺少可选集合；仅修正两处可选读取，原测试转绿。后续单实例静态保护检查要求ready入口原样立即return，已恢复原门禁而未修改测试断言；Memory-health要求MemoryEngine接近configure末尾，新增诊断依赖调整到其前，保持原布局合同与同一实例注入，末尾36组原测试全通过。追加独立反例验证诊断关闭／开启均保留恢复行为，取消和Provider错误在业务层可见且trace不泄漏正文；19个迁移源／旧group不存在、生产无强依赖、正式7桥文件保留。最终完整门禁结果执行后单列。

真实打包冒烟：`node scripts/v9.0-performance-packaged-smoke.js`，默认关闭与显式开启两进程均PASS／exit0；不同临时APPDATA，网络禁止、CK3未配置。Renderer第一就绪、真实100ms合成长任务和输入到frame被采集；非法私有字段拒绝、取消／点击导出通过。Knight截图人工检查。证据路径及代理指标限度见[性能调查](V9_STARTUP_PERFORMANCE_INVESTIGATION.md)。不把它称为真实CK3／Provider验收。

保留核验：[preservation-verification.json](preservation-verification.json)记录3536既有用户文件、安装Mod13文件、Workshop桥7文件与冻结SHA一致；独立manifest和QA另核冻结Git blob与CRLF转换。已安装Mod、原三上游Mod、Playset、存档与运行队列没有迁移或卸载。原正式letter-runner桥继续留在VOTC。

CI证据分层：旧远端[run38021500350](https://github.com/wsdsb-111/VOCT-NEW/actions/runs/38021500350)是旧SHA的Failure；本轮通过本地浅克隆复现历史对象缺失，再在同副本fetch-unshallow取得对象。修复未上传，GitHub Node22环境与最新V9 SHA的Actions结果仍CI_PENDING；没有V9提交SHA不能借旧成功run宣称当前CI绿。独立仓库为main、origin已设置、0commits；用户自行上传。

卡顿结论为ROOT_CAUSE_UNDETERMINED：用户报告周期性／点击／每NPC发言停顿，重启App恢复；未采实际CK3帧、3次冷启动首10轮、稳态20轮与真实Provider对照。CPU／Main event-loop／HTTP wire TTFT等未采集指标为NOT_MEASURED；本轮没有推测性优化。此前跨Provider、缓存遥测、长时运行、信件归档、年龄／披露等用户验收继续保留，新增诊断与新现场问题另行验收。

V9.0总体状态HOLD，不能宣称COMPLETE：用户上传后的两个仓库Actions／对应SHA、CK3有无可选Three-Mod对照和C1—C9现场性能复测尚待完成。本轮未执行commit／tag／push，也未启动V9.1施工。

版本对齐前的最终原始完整命令 `node scripts/test-release.js`：**409/409发布组PASS，exit0**。未改旧历史断言、未跳过组；新旧Memory／Disclosure／Forget／Worldline／Provider／Action／Letter／UI回归随同运行。日志在本机TEMP `votc-v9-final-release-20261011.log`，日志SHA与16个新增／修改生产／测试／CI文件指纹、19个退役路径登记于[本地验证证据](v9-local-evidence.json)。这是当时未提交工作树的源码指纹，不冒充V9 commit SHA或版本对齐后的最新指纹。该阶段测试后核对安装Mod13／Bridge7／用户既有3536文件hash全部一致，main仍为冻结SHA；本轮另有两份Workshop descriptor的预期版本变更，见版本对齐报告。

V9.1交接：保持Memory4/Owner/Campaign/Forget、OfficialAction/ACK回读、Letter/LOAD/一次归档、Worldline时点、Prompt块/cache键、三主题与包版本合同。V9.1才建立正式可重建src/build，本轮不提前施工。回退用冻结源码archive/LFS恢复代码或独立迁移manifest，不能覆盖用户数据或重放Effect。
