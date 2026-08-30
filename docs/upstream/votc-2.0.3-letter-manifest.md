# VOTC 2.0.3 Letter 上游清单

上游项目：`Voices-of-the-Court/VOTC`  
上游版本：`v2.0.3`  
本地运行参考：`C:\Users\97330\AppData\Local\Programs\voices-of-the-court-official-2.0.3`  
许可证：GPL-3.0-only

## 上游 Blob SHA

| 上游文件 | Blob SHA |
| --- | --- |
| `LetterManager.ts` | `1338f1abefd4ea6bf55e0b1ee5add1dc3b547204` |
| `LetterPromptBuilder.ts` | `3db5ebeffd5d6383bcaeec36cdb6a8c1695ce61b` |
| `types.ts` | `860784e0e9f190580ed9ab1171965d88ede3af7e` |

## V7.10 对应路径

- Letter 运行时：`resources/app/out/main/letters/letter-manager.js`
- 官方 Prompt Builder：`resources/app/out/main/prompts/letter-prompt-builder.js`
- Delivery Recovery 回归：`scripts/test-v7.10-letter-delivery-recovery.js`

官方 Delivery Effect 是唯一投递语义来源：创建回信 Artifact，写入 `votc_letter_artifact`，设置全局 `votc_latest_letter`，并触发 `message_event.362`。V7.10 的载荷重试、待投递持久化、日志 tail 恢复、摘要写入和 `LETTER_ACCEPTED` 清理均位于外围可靠性层，不修改官方 Effect 语义。

