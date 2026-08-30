# VOTC 2.0.3 Action System 上游清单

上游项目：`Voices-of-the-Court/VOTC`  
上游版本：`v2.0.3`  
本地运行参考：`C:\Users\97330\AppData\Local\Programs\voices-of-the-court-official-2.0.3`  
许可证：GPL-3.0-only

## 上游 Blob SHA

| 上游文件 | Blob SHA |
| --- | --- |
| `ActionEngine.ts` | `700883315e528ffa1ae437391c03b45bf17de283` |
| `ActionPromptBuilder.ts` | `182aab83c49880263b262aa2f7045c738f0eea2d` |
| `ActionRegistry.ts` | `9f603dc355781f3b3e0dff475c51823480529dca` |
| `ActionSandbox.ts` | `24b4629d506850d25f34c52365767fa4db4ea10b` |
| `ActionEffectWriter.ts` | `b2232975bb1500395893f3c3b3c80048c4f28e94` |
| `RunFileManager.ts` | `70d191fc331b625b5a138a60f3ebb5fb8d0359de` |
| `i18nUtils.ts` | `36d17f4bad1a4214f508065c43678a1708235862` |
| `jsonSchema.ts` | `71bae4247e913f0f7d75bb45d2422c3617a4f685` |
| `schema.ts` | `3c024d703a0daa861eaf625fadc36f36fb9b5595` |
| `responseHealing.ts` | `9dfc6633e26726c9b3463ebc1a579355219a72a1` |
| `types.ts` | `0fd7454cc2f380d3c9eca1996579c32167abc045` |

## V7.10 对应路径

- 官方 Action 内核：`resources/app/out/main/actions/`
- 官方 28 个标准动作：`resources/app/default_userdata/actions/standard/`
- 对话基础设施适配：`resources/app/out/main/conversation/`
- parity 回归：`scripts/test-v7.10-official-action-system.js`

V7.10 只做 CommonJS、路径、设置、Provider、Analytics、UI routing 和打包适配。Prompt、JSON Schema、`votc_actions` 名称、response healing、审批流程、动作 `check()` / `run()` 和 CK3 Effect 语义均以官方 2.0.3 为准。自定义动作首版不加载，用户目录中的自定义文件不会被删除。

