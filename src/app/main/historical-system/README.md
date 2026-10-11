# V8 Historical System

This directory retains the historical baseline and the campaign/worldline persistence boundary. The V8.3/V8.3.1 Historical Figure Shadow Resolver, Ground Truth store, diagnostic IPC, and dashboard were retired in V8.8 Terra Stage 6. They are not part of the runtime contract.

## Current modules

- `schema.js`: validates the structured historical baseline contracts.
- `historical-data/`: period, event, figure, and definition metadata used by the baseline and V8.8 Definition-ID binding.
- `historical-baseline.js`: exposes `getPeriodByYear()`, `getLegacyReferenceByYear()`, and a read-only baseline snapshot.
- `compatibility-adapter.js`: projects structured data into the legacy `{ period, context, notableEvents, notableFigures }` shape.
- `temporal-knowledge-gate.js`: date parsing and fail-safe temporal availability logic.
- `campaign-identity.js`: validates a CK3 save token and derives a stable campaign identifier; missing or invalid tokens degrade to a non-persistent session identity.
- `worldline-store.js`: validates and atomically persists schema-version-1 `worldline.json`; unknown or corrupt state is never overwritten.
- `dynamic-history-service.js`: attaches only campaign identity and worldline state to the current GameData instance. It has no historical-person resolver or `figureResolution` state.

## Dependency boundary

```text
historical-data + schema
          ↓
historical-baseline
          ↓
compatibility-adapter
          ↓
game-data/legacy-historical-reference.js

CK3 VOTC:CAMPAIGN → LogParser
                         ↓
               DynamicHistoryService
                    ↙          ↘
          CampaignIdentity   WorldlineStore
```

Historical character identity is resolved in `worldline/historical-identity-resolver.js` through the V8.8 Definition-ID to runtime-ID binding. It is deliberately outside this legacy compatibility boundary.

`dynamicHistory` and compatibility entry `historicalCampaignIdentity` are non-enumerable and excluded from object spreading and JSON serialization. The baseline, campaign state, and worldline store do not modify Prompt, Memory, Conversation, Action, Letter, CK3 files, or Run Command Queue semantics.
