"use strict";

const assert = require("assert");
const { resolvePlayerPoliticalContext } = require("../resources/app/out/main/worldline/political-context");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

function title(id, key, holder, deFactoLiege = null) {
  return { id: String(id), key, holder: holder == null ? null : String(holder), deFactoLiege, deJureLiege: null, history: [] };
}

function snapshot({ domainTitles, titles }) {
  return {
    playerId: "100",
    characters: {
      "100": { id: "100", firstName: "Player", domainTitles },
      "200": { id: "200", firstName: "Duke", domainTitles: [] },
      "300": { id: "300", firstName: "King", domainTitles: [] }
    },
    titles
  };
}

const vassalSnapshot = snapshot({
  domainTitles: ["10"],
  titles: {
    "10": title("10", "c_verified_county", "100", "20"),
    "20": title("20", "d_verified_duchy", "100", "30"),
    "30": title("30", "k_verified_realm", "300", null)
  }
});
const vassal = resolvePlayerPoliticalContext(vassalSnapshot);
assert.equal(vassal.primaryTitle.rawKey, "d_verified_duchy", "primary title must be the highest player-held title in the de facto chain");
assert.equal(vassal.directLiege.title.rawKey, "k_verified_realm", "direct liege title must be the parent of the player primary title");
assert.equal(vassal.directLiege.ruler.displayName, "King", "direct liege ruler must come from the evidenced title holder");
assert.equal(vassal.topRealmTitle.rawKey, "k_verified_realm", "top realm must follow the de facto hierarchy rather than title enumeration order");
assert.equal(vassal.topRealmRuler.displayName, "King", "top realm ruler must come from the top realm holder");

const rootSnapshot = snapshot({
  domainTitles: ["10", "20"],
  titles: {
    "10": title("10", "c_subordinate", "100", "20"),
    "20": title("20", "h_root_realm", "100", null)
  }
});
const root = resolvePlayerPoliticalContext(rootSnapshot);
assert.equal(root.primaryTitle.rawKey, "h_root_realm", "an unranked but evidenced root title must not depend on key-prefix heuristics");
assert.equal(root.directLiege, null, "a title without de facto liege must remain independently confirmed");
assert.equal(root.confidence.directLiege, "INDEPENDENT", "independence must be explicit rather than guessed");

const ambiguousSnapshot = snapshot({
  domainTitles: ["10", "20"],
  titles: {
    "10": title("10", "d_first_independent", "100", null),
    "20": title("20", "d_second_independent", "100", null)
  }
});
const ambiguous = resolvePlayerPoliticalContext(ambiguousSnapshot);
assert.equal(ambiguous.primaryTitle, null, "multiple independent player roots must not pick the first title");
assert.equal(ambiguous.reason, "MULTIPLE_PLAYER_TOP_TITLES", "ambiguous political evidence must remain explicit");

const missingSnapshot = snapshot({
  domainTitles: ["10"],
  titles: {
    "10": title("10", "c_broken_chain", "100", "999")
  }
});
const missing = resolvePlayerPoliticalContext(missingSnapshot);
assert.equal(missing.primaryTitle, null, "missing de facto liege evidence must fail closed");
assert.equal(missing.reason, "DE_FACTO_LIEGE_MISSING", "broken title hierarchy must expose the missing-evidence reason");

const incompleteDomainSnapshot = snapshot({
  domainTitles: ["10", "999"],
  titles: {
    "10": title("10", "d_only_visible_branch", "100", null)
  }
});
const incompleteDomain = resolvePlayerPoliticalContext(incompleteDomainSnapshot);
assert.equal(incompleteDomain.primaryTitle, null, "an unresolved player domain title must not be silently discarded");
assert.equal(incompleteDomain.reason, "PLAYER_DOMAIN_TITLE_MISSING", "incomplete domain evidence must fail closed before selecting a primary title");

const mismatchedDomainSnapshot = snapshot({
  domainTitles: ["10", "20"],
  titles: {
    "10": title("10", "d_player_branch", "100", null),
    "20": title("20", "d_inconsistent_branch", "200", null)
  }
});
const mismatchedDomain = resolvePlayerPoliticalContext(mismatchedDomainSnapshot);
assert.equal(mismatchedDomain.primaryTitle, null, "a domain title held by another character must not be ignored");
assert.equal(mismatchedDomain.reason, "PLAYER_DOMAIN_TITLE_HOLDER_MISMATCH", "holder inconsistency must remain explicit");

const missingRulerSnapshot = snapshot({
  domainTitles: ["10"],
  titles: {
    "10": title("10", "d_player_vassal", "100", "20"),
    "20": title("20", "k_missing_ruler_record", "999", null)
  }
});
const missingRuler = resolvePlayerPoliticalContext(missingRulerSnapshot);
assert.equal(missingRuler.primaryTitle.rawKey, "d_player_vassal", "the evidenced player title remains valid when the realm ruler record is absent");
assert.equal(missingRuler.topRealmRuler, null, "a missing character record must not be represented as a confirmed ruler");
assert.equal(missingRuler.confidence.topRealmRuler, "PARTIAL", "the title holder id remains evidence, but ruler details are only partial");

function overviewFor(targetSnapshot) {
  return WorldlineService.prototype.getOverview.call({
    currentCheckpoint: { snapshot: targetSnapshot },
    getLiveState: () => ({ connected: false, gameDate: null }),
    getCheckpointStatus: () => ({ checkpoint: { freshness: "FRESH" } }),
    _currentCampaignDelta: () => [],
    listSupplemental: () => ({ supplemental: [] })
  }).overview;
}

const evidencedOverview = overviewFor(vassalSnapshot);
assert.equal(evidencedOverview.primaryTitle, "d_verified_duchy", "overview primary title must come from the resolver result");
assert.equal(evidencedOverview.directLiege, "King", "overview direct liege must come from the evidenced parent holder");
assert.equal(evidencedOverview.topRealmTitle, "k_verified_realm", "overview top realm must preserve the resolved hierarchy");
assert.equal(evidencedOverview.currentRuler, "King", "overview current ruler must be the evidenced top realm holder");

const unknownOverview = overviewFor(incompleteDomainSnapshot);
assert.equal(unknownOverview.primaryTitle, null, "overview must display unknown instead of guessing from a partial domain");
assert.equal(unknownOverview.currentRuler, null, "overview must not synthesize a ruler when political context is unknown");

console.log("V8.4.1 Political Context: PASS (complete domain evidence, hierarchy, ruler identity and fail-closed ambiguity)");
