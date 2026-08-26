"use strict";

const path = require("path");

function createPaths(app) {
  const VOTC_DATA_DIR = path.join(app.getPath("userData"), "votc_data");
  const VOTC_PROMPTS_DIR = path.join(VOTC_DATA_DIR, "prompts");
  return {
    VOTC_DATA_DIR,
    VOTC_LOGS_DIR: path.join(VOTC_DATA_DIR, "logs"),
    VOTC_SUMMARIES_DIR: path.join(VOTC_DATA_DIR, "conversation_summaries"),
    VOTC_MEMORY_DIR: path.join(VOTC_DATA_DIR, "memory"),
    VOTC_MEMORY_RECOVERY_DIR: path.join(VOTC_DATA_DIR, "memory_recovery"),
    VOTC_ACTIONS_DIR: path.join(VOTC_DATA_DIR, "actions"),
    VOTC_USAGE_ANALYTICS_FILE: path.join(VOTC_DATA_DIR, "usage-analytics.json"),
    VOTC_PROMPTS_DIR,
    VOTC_PROMPTS_SYSTEM_DIR: path.join(VOTC_PROMPTS_DIR, "system"),
    VOTC_PROMPTS_CHARACTER_DIR: path.join(VOTC_PROMPTS_DIR, "character_description"),
    VOTC_PROMPTS_EXAMPLES_DIR: path.join(VOTC_PROMPTS_DIR, "example_messages"),
    VOTC_PROMPTS_HELPERS_DIR: path.join(VOTC_PROMPTS_DIR, "helpers"),
    DEFAULT_PROMPTS_DIR: path.join(app.getAppPath(), "default_userdata", "prompts")
  };
}

module.exports = { createPaths };
