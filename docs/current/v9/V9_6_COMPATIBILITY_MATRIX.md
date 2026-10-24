# V9.6 版本、能力与失效策略候选

> Historical exploration: unified Workshop distribution and Bootstrap proposals are superseded by the user-authorized independent Mod/Runtime design. See [V9.6 implementation](V9_6_IMPLEMENTATION.md), [verification](V9_6_VERIFICATION.md) and [pairing](V9_6_RELEASE_PAIRING.md).

日期：2026-10-24。**以下为待批准设计，未实现握手、未修改现有门禁。** 当前事实以[协议矩阵](V9_6_BRIDGE_PROTOCOL_MATRIX.md)为准。

## 版本必须分开

| 维度 | 当前证据 | 下一阶段用途 |
| --- | --- | --- |
| App/Core/UI | 9.5.1，Runtime060e336 | 产品发布，不要求与Mod字符串相同 |
| 本机Mod | descriptor2.0.5／CK3 1.20.* | 本地声明，不能证明游戏当前加载的字节 |
| 上游参考Mod | 固定0cf4845，descriptor2.0.4 | 来源追踪，不是本机快照的替代版本 |
| Official Action | official-votc-2.0.3 | 动作业务基线，非Bridge版本 |
| Memory／Legacy存储 | MEMORY_ENGINE_VERSION3.0；既有Legacy2.5兼容 | 记忆合同，非Bridge协议主版本 |
| Bridge wire/schema | 未找到正式声明或配对协商 | 新增独立major/minor与schema定义，数值TBD |

不采用“App版本等于Mod版本才可用”。改UI／Provider／Prompt内部逻辑可独立发App；改游戏场景／图形且保持合同可独立发Mod；更改IN列序、事件ID、scope变量或ACK含义属于合同变更，需要适配与交叉版本测试。

## 按功能划分必需能力

| 功能 | 当前实际依赖 | 候选策略 |
| --- | --- | --- |
| 基础对话 | 可完整解析的IN init／character、合法玩家／人物身份、唤醒入口 | 资料缺失阻止该次生成；不凭Hello声明补造人物事实 |
| Trait／亲属 | 有key或旧兼容Trait、年龄和公开家谱证据 | 缺失保持未知，沿既有权限规则；不能为继续聊天猜测特质、身份或亲属 |
| 多人Presence | Mod候选列表＋App在场状态与定向披露 | `presence_v2`目前只是路线图候选名，不宣称Mod已实现该wire能力 |
| Action写入 | RunFile consumer、Mod effect／scope符号、command ID去重、匹配ACK | 证据不够只阻断相关副作用；ACK仍不等于效果CONFIRMED，旧未知命令不重放 |
| 金币／意见确认 | 上述链路＋BEGIN—ACK内真实回读及相同人物绑定 | 无回读可保持UNCONFIRMED，不能以“兼容”显示成功 |
| 日期驱动信件 | 当前载入边界、连续DATE、VOTC RunFile、收件scope／宝物／事件、receipt门禁 | 缺失时等待／提示具体能力，不恢复已退役letters.txt consumer |
| Worldline | 存档源、分支身份、历史／本地化读取和来源授权 | 与Bridge健康分别报告；不能把存档可读当成Mod已加载 |

`trait_key_v1/run_ack_v2/letter_v2/native_date_v1`等名称可留作后续合同命名候选。现有源码实现证据、声明证据和实机能力证据必须分栏；当前没有Hello，所以这些不是已协商通过的capabilities。

## 候选清单结构

未来静态发布清单应包含：schema版本、独立Bridge协议major/minor、Mod版本和源指纹、Runtime支持的协议范围／能力版本、工件内容哈希、CK3目标范围、最小Bootstrap版本与许可索引。能力应声明具体contract revision，不用营销版号代替。

未来Hello只输出最小机器字段：schema／协议、实际编译时Mod声明、能力revision、关联载入标记。日志文件身份、边界offset、截断世代由Runtime接收端维护。不能把Receipt token、用户凭据或任意本地路径放入公开Hello。

不预先分配生产协议号或写入`bridge-manifest.json`。未知可选字段的忽略规则只适用于新协议明确规定的envelope；不能套用到当前固定位置CSV式行或Trait长度启发式。

## 状态与交叉版本

| 状态 | 应有证据／行为 |
| --- | --- |
| UNKNOWN/PENDING | 未收到当前边界Hello，或日志身份未知；显示未验证，不能显示SUPPORTED |
| SUPPORTED | 当前边界声明合法、major受支持、相关必需contract revision满足；仍分别显示通道健康与效果状态 |
| DEGRADED | 仅明确的可选功能缺失；标明禁用范围，不改变Memory／来源权限 |
| INCOMPATIBLE | 确认major不支持、必需contract不匹配或声明非法；阻断受影响操作并保留诊断／队列证据 |

| 组合 | 预期判定 |
| --- | --- |
| 旧Mod／无Hello＋新App | legacy/unverified；只可按经过fixture与实机确认的旧合同路径运行，不自动变绿，也不因一次Hello超时关闭所有聊天 |
| 同major兼容minor或App补丁升级 | 必需contract满足时允许；未变化的另一工件无须重发，但统一包更新后的激活需核验 |
| 新major＋旧App／缺必需能力 | 不兼容对应功能；保留旧适配器或提供兼容工件，不静默猜格式 |
| 新App＋旧Mod仍满足合同 | 允许支持范围内组合，不要求版号锁步 |
| 未知可选能力／字段 | 按明确schema规则忽略并记录；未知必需项拒绝 |
| 磁盘已更新、CK3仍加载旧Mod | 以本场载入证据为准，提示需要重启／重载；禁止用磁盘descriptor覆盖内存版本 |

## 边界和旧状态失效

新载入边界、日志文件身份改变、截断／原地重写或来源不确定时，旧兼容状态失效。`votc_load_epoch`存在存档中，重复加载同一旧存档后可能输出同样文本；这是静态推断，未实测为Bug。现有Letters已组合日志身份／偏移／轮转和anchor；Worldline当前probe只组合birthtime或ctime弱身份、绝对offset与token，未见此路径持续跟踪截断世代，不代表已能辨别所有原地重写。未来Hello需要明确的日志世代和载入边界，不能只使用token字符串。

只读Hello证明“该声明路径执行过”；匹配的无副作用往返才能证明“本次consumer可收发”；业务Effect仍需自己的回读。文件存在、Mod加载、Bridge收发、业务效果四个状态不能折成一个绿色灯。

安全Probe暂不实现：当前RunFile统一封装会追加9003，不能把普通Action／Letter作为探针，更不能覆盖真实`votc.txt`。先独立fixture验证，再在隔离游戏目录证明专用路径无游戏副作用。
