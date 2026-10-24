# V9.6 无副作用原型与实机验收计划

> Historical exploration: unified Workshop distribution and Bootstrap proposals are superseded by the user-authorized independent Mod/Runtime design. See [V9.6 implementation](V9_6_IMPLEMENTATION.md), [verification](V9_6_VERIFICATION.md) and [pairing](V9_6_RELEASE_PAIRING.md).

日期：2026-10-24。状态：**计划，全部新原型与实机项NOT_RUN**。本轮只做[源与协议探索](V9_6_PRE_EXPLORATION.md)，没有调用真实Provider或游戏Effect。

## 逐层验证

| 层 | 目标与验收证据 |
| --- | --- |
| T1源码清点 | 源manifest／descriptor／事件、effect、GUI和localization引用完整；来源哈希、许可与上游差异可重现 |
| T2解析fixtures | IN固定列、61类数据、旧新Trait、Unicode／多行／分隔符、未知类型、半行和乱序；不使用真实对话或凭据 |
| T3双端合同 | 从拟纳管Mod产生匿名导出样例，由实际Runtime parser解析；command ID、kind、Source／Target、Receipt字段一致 |
| T4隔离打包 | 完整EXE与临时CK3用户目录，读模拟日志、构造临时carrier；个人userData与真实RunFile不参与 |
| T5 CK3引擎 | 真正加载Mod、新档／读档、触发GUI、DATE、可控Action与Letter；记录版本、存档测试范围及效果回读 |
| T6更新／恢复 | App与游戏重启、日志轮转截断、载体半写、ACK延迟／丢失、更新文件锁、回滚；无未知效果重放 |

T1–T4不证明引擎一定加载全局widget或执行Effect。旧V9.5.1的505组CI只作为历史Runtime证据，不能标成V9.6通过。

## Hello／Probe先行原型

先测试独立schema与纯解析，不接生产。覆盖合法／非法schema、受支持与不受支持major、旧Mod无Hello、缺可选／必需contract、重复Hello、延迟旧Hello、相同文本LOAD标记在不同offset、原地日志重写、App重启后日志证据不完整。不得把存在descriptor当成加载成功。

若进入游戏原型，Hello仅输出声明与边界；专用Probe只回显随机关联标识，不创建宝物、不写人物变量、不推进业务队列、不触发9003界面事件。必须先审查路径确实无副作用；当前通用RunFile封装会追加9003，因此不能直接复用普通Action／Letter probe。全部使用隔离CK3用户目录、测试存档和临时carrier，绝不覆盖或清空真实`votc.txt`。

## 必须签署的真实场景

| 场景 | 核验 |
| --- | --- |
| 新档启动、关闭聊天窗口、暂停／推进时间 | 全局widget实际注册，非对话期DATE持续；暂停时日期不推进不等于断线 |
| 保存／读档／同一旧档连续读两次 | 新日志边界使旧Hello和DATE失效；重复token文本不串用状态 |
| 开场／换人物／退出 | 日志导出与剪贴板唤醒先后、实际人物ID、原生头像与Electron对话对应，候场／缺席不扩大知情 |
| 一次低风险可控Action | command ID、列表绑定、重复GUI消费、BEGIN—ACK、实际前后值；区分ACK与CONFIRMED |
| 信件发送／到期／接收 | sendDay+delay、唯一宝物、362显示、匹配receipt、唯一摘要；重启后不重复投递 |
| 禁用Mod／旧Mod／移除某能力／其他Mod覆盖 | 状态与禁用范围准确，不默认为兼容，不使用真实高风险效果作为探针 |
| Workshop仅更新Mod／仅更新Runtime／同时更新 | 正在运行进程不被覆盖；下一安全启动取得支持范围内组合，旧工件可回退 |
| 无独立多Mod兼容补丁、离线无GitHub | 自身Bridge可独立工作；订阅payload具备完整依赖和入口，不额外要求玩家下载Runtime |
| 125%／150% DPI、焦点／穿透、长时运行 | 新入口不改变既有桌面输入行为；Soak记录资源与恢复结果，不仅截图 |

每次记录：CK3版本、Mod工件哈希／声明、Runtime工件哈希／版本、加载组合、隔离用户目录、会话／命令关联证据、观察到的实际效果和失败项。公开报告仅放脱敏结论，不提交真实日志、存档、队列或密钥。

## 前置探索完成度

已完成本机源树、SHA-256、七个补丁对照、固定上游差异、跨端producer／consumer和候选兼容／分发方案登记。**尚未完成**唯一权威源最终批准、发布账户／平台确认、正式schema定稿、Hello／Probe实现和实机验收；不能据此宣布V9.6发布或Full Freeze。
