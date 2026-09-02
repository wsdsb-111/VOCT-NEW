"use strict";

const assert = require("assert");
const { parseGameState } = require("../resources/app/out/main/worldline/game-state-adapter");

const snapshot = parseGameState(`date=1155.1.1
living={ 100={ first_name=Attacker } 101={ first_name=Defender } }
dead_unprunable={}
characters={ dead_prunable={} }
wars={ active_wars={
  900={ attacker={ character=100 score=399 value=0 contribution=137 } defender={ participant={ character=101 score=245 } } start_date=1155.1.1 }
  901={ attacker={ participant={ character=999 } } defender={ contribution=88 score=77 } start_date=1155.1.1 }
} }
`);
assert.deepEqual(snapshot.wars["900"].attacker, ["100"], "only an explicit known character field may become an attacker");
assert.deepEqual(snapshot.wars["900"].defender, ["101"], "nested explicit participant character fields must remain supported");
assert.deepEqual(snapshot.wars["901"].attacker, [], "unknown explicit runtime IDs must be rejected");
assert.ok(snapshot.diagnostics.warParticipantRejectedNumericTokens.includes("399"), "score-like numeric fields must be observed as rejected, never treated as IDs");
assert.ok(snapshot.diagnostics.warParticipantRejectedNumericTokens.includes("245"), "nested participant scores must also remain visible in rejection diagnostics");
assert.ok(snapshot.diagnostics.warParticipantRejectedNumericTokens.includes("88"), "generic numeric war fields must be rejected rather than inferred as IDs");
assert.ok(snapshot.diagnostics.warParticipantUnknownRuntimeIds.includes("999"), "unknown explicit IDs must be diagnosable");
console.log("V8.4.2 War Participants: PASS (explicit-field parser, numeric rejection and unknown-ID diagnostics)");
