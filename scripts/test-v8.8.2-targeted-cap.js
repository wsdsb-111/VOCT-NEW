"use strict";

const assert = require("assert");
const { getTargetedKinshipGraph } = require("../resources/app/out/main/worldline/kinship-graph-cache");

const truncated = getTargetedKinshipGraph({
  contentFingerprint: "cap-truncated",
  characters: {
    1: { id: 1, children: [2] },
    2: { id: 2, children: [3] },
    3: { id: 3 }
  }
}, [1], { maxDepth: 3, maxNodes: 2 });
assert.equal(truncated.scopeTruncated, true, "an unseen neighbor at the exact cap must mark the graph incomplete");
assert.equal(truncated.nodes.get("3").partial, true, "the unexpanded neighbor may exist only as a partial relation endpoint");

const complete = getTargetedKinshipGraph({
  contentFingerprint: "cap-complete",
  characters: {
    1: { id: 1, children: [2] },
    2: { id: 2 }
  }
}, [1], { maxDepth: 3, maxNodes: 2 });
assert.equal(complete.nodes.size, 2);
assert.equal(complete.scopeTruncated, false);

console.log("V8.8.2 Targeted Cap: PASS");
