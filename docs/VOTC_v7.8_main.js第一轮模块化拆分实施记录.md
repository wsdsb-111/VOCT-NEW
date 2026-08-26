# VOTC v7.8 main.js 第一轮模块化拆分实施记录

## 实施目标

v7.8 是进入 V8 历史系统开发前的结构基线。本阶段只移动既有实现并显式注入依赖，不新增历史知识、修改提示词顺序、变更 IPC 名称、设置键、动作 ID、Memory Engine 数据格式或用户目录结构。安装包元数据 `resources/app/package.json` 继续保持 `2.0.4`，应用功能基线更新为 `7.8`，Memory Engine 保持 `2.4`。

## 拆分结果

- `main.js` 从约 6697 行缩减到约 1290 行，保留 Electron 生命周期、对象组装、动作运行时胶水、窗口/tray/快捷键和 IPC 注册入口。
- 路径与设置迁入 `config/`，用量统计迁入 `analytics/`。
- `Character`、`GameData`、`parseLog` 与旧历史参考函数迁入 `game-data/`；`GameData` 通过显式依赖使用旧历史参考函数，为 V8 替换历史 Provider 留出边界。
- Prompt 配置、脚本沙箱、模板引擎、脚本加载、对话 Prompt 与信件 Prompt 迁入 `prompts/`。
- 对话、摘要、信件、RunFile、更新器和焦点监视分别迁入 `conversation/`、`summaries/`、`letters/`、`runtime/` 与 `app/`。
- `historical-system/` 仅建立 V8 预留说明；v7.8 仍使用 `game-data/legacy-historical-reference.js`，没有提前实现 V8 历史功能。
- 新模块均不反向 `require` `main.js`；打包入口以明确的工厂依赖完成组合，避免隐式全局回流。

## 验证

- `node --check resources/app/out/main/main.js` 及全部新增主进程模块语法检查通过。
- `scripts/test-v7.8-main-modularization.js` 验证模块清单、依赖方向、main 组合根行数、核心版本、Character 合同、旧历史参考的多个年份输出，以及最小 CK3 `debug.log` 夹具解析。
- `node scripts/test-action-system.js` 通过，65 项动作测试与 14 项边界测试保持通过。
- `node scripts/test-release.js` 通过 38 个发布组，清单覆盖 71 个测试文件。
- 桌面端首次启动冒烟发现并补齐 `SettingsRepository` 的 Prompt 哈希与默认模板依赖；修复后重新启动，设置读取、33 个动作加载、95 个 IPC 注册、窗口、托盘、焦点监视和 CK3 日志 tail 均正常，启动日志无模块装配错误。

## 验证边界

自动化证明静态模块边界、主要数据合同、日志夹具、摘要/记忆/动作回归保持一致；真实 CK3 对话、Provider 请求、托盘/焦点、更新器和退出时最终摘要排空仍需发布前手动冒烟。动作执行运行时胶水本轮按方案保留在 `main.js`，避免在 V8 前同时扩大高风险改动面。
