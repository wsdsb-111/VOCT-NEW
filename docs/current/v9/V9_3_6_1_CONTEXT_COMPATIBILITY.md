# V9.3.6.1 Context 兼容说明

## 旧配置与 Auto／Custom

| 配置 | 有效窗口与来源 |
|---|---|
| 无 contextMode，customContextLength=90000 | 保留 Custom 90000；不按数值猜测它是否曾为默认值 |
| 无 mode，未填写／null custom | Auto；不迁移或重写真实配置 |
| 明确 Auto，保留合法旧 custom 值 | Auto 优先；只有用户明确切换才使用原生窗口 |
| Auto＋可信模型元数据 | 使用匹配当前模型的原生窗口，测试 131072／262144／1048576 |
| Auto＋未知／bundled_unverified | 8192 safe_fallback，界面明确提示来源未知 |
| Custom 120000＋可信原生 65536 | 保存用户声明，实际窗口 65536，provider_native_cap；界面提示有效值受限 |
| 通用兼容端点 Custom，无可信元数据 | 允许合法用户声明，user_provided_unverified；不宣称已验证原生能力 |
| 错误 mode／缺失或非法 Custom | 保存时拒绝；若读到旧坏配置则 invalid_configuration_fallback，取 min(可信窗口,8192) |

上下文输入严格要求 number 类型、256–2,000,000 的安全整数；空值、字符串、浮点、NaN、Infinity、溢出或超范围不能作为合法 Custom 保存。Renderer 不再 parseInt 截断输入；非法输入进入明确警告状态，IPC 与 SettingsRepository 双层拒绝，不能静默保存此前有效数值。两个既有 V8.9 90K 预设明确保留 Custom。

## 原生来源与缓存

当前可信原生信息来自主进程既有 OpenRouter /models 的 context_length、Gemini /models 的 inputTokenLimit；沿已有模型列表返回 contextLengthSource=provider_native，不新增专用 probe 或生成请求。Gemini 捆绑回退列表标为 bundled_unverified，不作为已验证原生能力。其他端点若没有可信信息，Auto 使用安全回退，用户可明确选择 Custom。

内部 resolver 保留无 provenance 的旧 model metadata 兼容调用，并标为 provider_metadata，不能将其描述为 provider_native。当前生产 Provider 返回值均已注明来源；Renderer 保存的 modelNativeContext／contextLengthSource 等配置字段不会作为 model 参数进入 resolver。新增内部调用方仍须保持这一信任边界。

能力 cache key 已包含 contextMode、原有 provider instance／type、endpoint fingerprint、model ID 和数值限制；切换 Provider、模型、模式或 Custom 后重建能力与预算，不能复用旧模型窗口。测试确认模型切换触发新 lookup。

## 90K 审计

| 位置 | 类别与处理 |
|---|---|
| main.js、Renderer 默认智谱配置 | 旧默认 9e4 改为 Auto；既有配置不据数值迁移 |
| ContextLengthField 的 max／placeholder | 移除人为90K，增加 Auto／Custom 与来源／有效上限提示 |
| IPC getCurrent／getMax 异常返回 | 原 9e4 改为共享安全 fallback 8192 |
| settings-repository.js 两个 V8.9 preset | 明确自定义90K，保留并标 Custom |
| request-budget.js | 统一模式、严格数值、当前模型匹配、可信 cap、坏配置回退 |
| provider-capabilities.js／provider-service.js | cache key 与模型 lookup 跟随模式／模型变更 |
| 既有 V8.12 等90K测试、V9.2.3历史证据 | 测试输入／历史快照，不全局替换；人物ID与哈希字符串不是窗口限制 |

## 请求与记忆安全

大窗口仍经过 planRequestBudget：实际输入估算、安全余量、输出和协议开销一起扣除；每次 transport 前重算完整请求及记忆跨度／指纹、来源与会话守卫。LENGTH 续写追加 partial 和续写指令后重新预算，溢出或 Forget 后不能发送第二次请求。2／3／4+ 人记忆16%／18%／20%及4800／5600／6400硬顶不随1M Context增加；首次会话人数冻结合同不变。

专项包含90次断言（包括循环展开），覆盖设置读取与保存、IPC、能力切换、131K／262K／1M、native clamp、未验证声明、坏配置和1M记忆硬顶。原生Provider窗口是否与实际服务一致为 NOT_RUN；本报告不承诺任一模型当前窗口为1M。
