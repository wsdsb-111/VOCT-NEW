# 启动与逐轮性能调查

日期：2026-10-11；诊断入口LOCAL_PASS，根因 ROOT_CAUSE_UNDETERMINED，现场复测CK3_USER_GATE_PENDING。

用户本轮补充：游戏开始后每过几天或点击各种操作都会短暂停顿，每个NPC发言也会停顿；退出VOTC后台并重启后恢复。它扩大了调查范围，但不能证明轮询、模型或任何单一模块有错。当前没有CK3帧时间与该现场的主线程调用栈，不能宣称已修复或提高X%。

诊断目标：有限内存span记录main开场/summary/观察/Worldline/Memory/Prompt、每NPC轮次、Provider请求到首chunk/首可见content与结束、Clipboard及DATE/reader/watchdog；Renderer只记录自己的long task、frame gap、输入到下一frame与first ready。各进程只产生相对时长，以记录时间和startup/匿名session粗关联；不跨减performance.now原点。

诊断默认关闭；通过 `--diagnostics` 或 `VOTC_DIAGNOSTICS=1` 启动。不得记录Prompt、聊天、Memory、debug.log、原会话ID或路径/secret。bounded ring与per-stage有限样本给出采样窗口P50/P95，注明丢弃数量，不能伪装完整会话真实分位数。关闭时不启动monitor/Renderer RAF/持续日志，原DATE/信件/动作服务仍运行。

复测矩阵采用设计文档C1—C9：3次独立冷启动，各采首10轮；稳态第11—30轮；重启App但保留CK3；读档；NPC切换与多人；待信件副本；固定Provider与实际Provider；纯CK3对照；合法大日志副本。不清缓存/待投递/未知ACK，不拆正式Bridge。

现场采集待用户完成：导出有停顿与重启后顺畅两份诊断，记录操作时段、CK3帧数据可用性、同NPC/Provider/Mod条件。没有现场样本时不得对H1—H8定罪；本轮只实现可采集入口，不凭猜测做优化。合成span与隔离VOTC启动数据单列，不代替实机冷暖10/20轮。

实现边界：事件环2048条；每stage＋attribution保留256样本；匿名会话LRU128项；Renderer一批32条。默认启动不启用额外采样循环；开启后Renderer每秒合并上报。导出仅由用户点击“导出性能诊断”选择JSON路径；调用者无法传入任意路径。`provider.firstByte`表示首个归一化chunk，`firstVisibleToken`表示首个非空content，均为请求开始后的本地代理时长，不是HTTP传输层首字节或游戏第一帧。非流式请求只能在完整响应到达时记录。

没有采集的指标明确为NOT_MEASURED：CK3帧时间、Main CPU／event-loop delay、真实HTTP wire TTFT、独立序列化耗时、React逐次append成本及post-turn细分；不以白名单中存在stage或可选字段表示已测量。`ck3.gameLoad`是VOTC:IN入口工作耗时，不能称为CK3读取存档耗时。本轮不设置缺乏实测依据的性能阈值。

隔离真实VOTC.exe验证（Node24.13.0）：默认关闭无诊断按钮、报告事件为空；`--diagnostics`开启后按钮出现，真实Renderer长任务／输入到下一frame进入报告；取消导出、点击导出、非法私有字段拒绝均通过。使用独立APPDATA/LOCALAPPDATA和禁止网络的临时profile，无真实CK3／Provider。截图人工检查按钮可见，Knight主题窗口；不声称三主题实际窗口全部复测。

最终冒烟证据：`C:/Users/97330/AppData/Local/Temp/votc-v9-performance-smoke-dKpZhk/enabled/`。其中100ms长任务为合成验证，不是本次卡顿复现；44条事件只证明采集链路运行，不能作为冷暖性能基线。
