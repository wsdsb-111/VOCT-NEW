# Voices of the Court（VOTC）

Voices of the Court 是一个面向《Crusader Kings III》（CK3）的沉浸式 AI 宫廷对话工具。它读取 CK3 的游戏日志和角色数据，将当前日期、朝代、角色关系、场景、记忆与历史背景整理为提示词，再通过兼容 OpenAI Chat Completions 格式的 API 生成角色扮演回复。

本仓库保存的是 VOTC 的 Windows 打包版本及默认用户数据，适合直接运行、测试和二次配置。

## 主要功能

- **CK3 角色扮演对话**：根据角色的性格、头衔、关系、财富、信仰、处境和当前场景生成回复。
- **动态历史背景**：从游戏日期提取年份，自动判断唐、五代十国、北宋、南宋和元朝等时期，并提供对应的事件和人物背景。
- **历史认知边界**：提示词要求角色只使用当前年份已经发生、写成、流传或成名的信息，避免引用未来人物、事件、诗词和典故。
- **当前政局优先**：皇帝和年号从实际游戏角色数据中识别，支持玩家篡位或改变历史后的沙盒玩法。
- **对话记忆与摘要**：按角色保存对话摘要，支持双方记忆共享，以及提及第三方角色时动态加载相关记忆。
- **信件系统**：读取 CK3 信件数据，生成符合收信人身份的回信，并保存信件摘要。
- **行动系统**：根据对话内容识别可执行的游戏行动，并通过结构化 JSON 请求保证参数格式。
- **多语言资源**：项目包含中文、英语、日语、韩语、俄语、德语、法语、西班牙语和波兰语等本地化资源。

## 运行环境

- Windows 10/11
- 《Crusader Kings III》
- CK3 1.18.*（模组版本要求）
- 一个兼容 OpenAI Chat Completions 格式的模型 API

## 快速开始

1. 下载或克隆本仓库。
2. 运行 `VOTC.exe`。
3. 在应用设置中配置 CK3 用户目录或 `debug.log` 路径。
4. 配置模型服务商、API 地址、模型名称和 API Key。
5. 启动 CK3 并启用 Voices of the Court 模组。
6. 进入游戏后即可开始对话、发送信件或使用相关互动。

首次使用前，建议在 CK3 启动器中确认模组版本与游戏版本匹配，并在应用中使用提示词预览检查角色数据是否正确加载。

## 模型 API 配置

应用支持 OpenAI 兼容接口，也可以使用 DeepSeek、OpenRouter 或其他兼容服务。请至少配置：

- API Key
- Base URL（如服务商要求）
- 默认模型
- 对话、摘要和行动请求所需的参数

不要将真实 API Key 提交到 GitHub。建议通过应用设置保存本地配置，并在公开仓库中只保留示例配置或截图。

## 动态历史系统

系统会从 CK3 日期中提取年份，并生成 `gameData` 历史字段，包括：

- `year`：当前年份
- `dynasty`：当前朝代
- `currentEmperor`：游戏中实际识别出的皇帝
- `currentEmperorTitle`：皇帝头衔
- `currentEraName`：年号（如果能够从头衔中识别）
- `historicalReferenceInfo`：历史时期、时代背景、事件和人物

历史认知规则还会要求模型在提及人物、事件、书籍、诗词、典故、制度或技术时，先将其出现、发生、写成、成名或流传时间与当前年份比较。年份不确定时，角色应回答“不曾听闻”或“并不知晓”，而不是用现代知识补全。

默认提示词位于：

`resources/app/default_userdata/prompts/system/default.hbs`

推荐的动态历史模板位于：

`推荐模板_动态历史版.hbs`

修改模板后，需要在应用设置中重新加载模板；修改打包目录中的 `main.js` 后，需要完全退出并重启应用。

## 对话摘要与记忆

摘要系统按角色姓名组织文件夹和对话记录，主要目标是：

- 保留双方最近的对话记忆；
- 在提到第三方角色时，按需加载相关历史；
- 控制提示词长度，减少不必要的 token 消耗；
- 支持旧格式迁移和重复角色记录合并。

相关工具：

- `migrate-to-character-folders.js`：迁移到按角色存储的目录结构；
- `merge-duplicate-characters.js`：合并重复角色记录；
- `migrate-summaries.js`：迁移旧版摘要数据。

详细说明请参考：

- `README_摘要系统.md`
- `动态历史认知系统_完整文档.md`
- `完整更新总结_v6.1.md`

## 项目结构

```text
voices-of-the-court/
├─ resources/app/out/main/main.js                    # 主程序逻辑
├─ resources/app/default_userdata/                   # 默认提示词、动作和本地化脚本
├─ locales/                                           # Electron 界面语言资源
├─ merge-duplicate-characters.js                     # 重复角色合并工具
├─ migrate-summaries.js                               # 摘要迁移工具
├─ migrate-to-character-folders.js                    # 角色文件夹迁移工具
├─ 推荐模板_动态历史版.hbs                            # 动态历史提示词模板
├─ 动态历史认知系统_完整文档.md                       # 历史系统文档
├─ README_摘要系统.md                                 # 摘要系统文档
└─ VOTC.exe                                           # Windows 应用入口
```

## 版本信息

- 当前应用功能版本：v6.1
- CK3 模组版本：Voices of the Court 2.0.2
- 模组支持版本：CK3 1.18.*
- 当前重点：动态历史认知、中文提示词、角色摘要和跨角色记忆

## 已知限制

- 历史知识核验依赖模型自身的年代知识，提示词规则可以显著降低穿越，但不能替代外部历史数据库。
- CK3 日志格式、角色头衔语言和本地化文本变化时，可能影响年份或皇帝识别。
- DeepSeek 等服务商的上下文缓存由服务端管理，命中率会受到请求前缀、模型、账号隔离和缓存生命周期影响。
- 旧摘要不会自动重写；清理或迁移摘要前请先备份用户数据。

## API 用量统计（v6.2 第一阶段）

应用会在每次对话、行动判定、摘要或信件请求完成后，将匿名化用量写入：

`%APPDATA%\Voices of the Court\votc_data\usage-analytics.json`

记录包含请求类型、服务商、模型、输入/输出 token、DeepSeek 缓存命中与未命中 token，以及对话提示词各区块的估算 token；不会保存提示词正文、模型回复或 API Key。主进程同时暴露 `usageAPI.getReport()` 和 `usageAPI.clear()`，便于后续设置页或调试工具读取与清空统计。

## 缓存前缀优化（v6.2 第二阶段）

对话请求现在会在动态角色卡、历史摘要和对话历史之前加入固定的 `VOTC_CACHE_ANCHOR_v1` 系统消息。它不包含日期、角色名或游戏状态，因此不会因切换角色或推进日期而变化；原有记忆摘要、历史系统和角色扮演区块仍按原逻辑生成。缓存命中率应以实际 API 返回的 `prompt_cache_hit_tokens` 与 `prompt_cache_miss_tokens` 为准。

动作模型同样使用固定的 `VOTC_ACTION_CACHE_ANCHOR_v1`。更重要的是，只有最近对话明确叙述了会改变 CK3 状态的动作时才会调用动作模型，例如付款、囚禁、伤害或处决、建立或解除关系、任免与雇佣、改宗或臣属关系、离开对话或移动、脱衣或发生亲密行为。普通交谈、计划、威胁、情绪、诗词与历史讨论不会触发动作请求；同一段动作叙述只会处理一次，避免多名 NPC 连续回复时重复扣费或重复执行。

## 许可证

模组文件遵循项目原有许可证。Voices of the Court 2.0 Mod © 2026 Durond 与 MrAndroPC，采用 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 授权。

Electron、Chromium 及其他第三方组件分别遵循其随附许可证，详见 `LICENSE.electron.txt` 与 `LICENSES.chromium.html`。

## 致谢

感谢 Voices of the Court 原作者、CK3 Mod 社区，以及所有参与测试、翻译、历史提示词和摘要系统改进的用户。
