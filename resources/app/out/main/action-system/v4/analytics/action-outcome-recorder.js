"use strict";

function record(analytics, input) {
  analytics?.record?.({
    requestType: "action_v4_outcome",
    engineVersion: "4.0",
    ...input
  }, null);
}

module.exports = { record };
