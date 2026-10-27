"use strict";

const { nonnegativeNumber } = require("../worldline/character-age-service");

const fs = require("fs");
const readline = require("readline");
const { inferGenderFromPronoun } = require("./character");

function parseRelativeAge(data, index, gameData, sourceOwnerId, relationType, field) {
  const ageText = String(data[index] ?? "").trim();
  const parsedAge = /^(?:0|[1-9]\d*)$/.test(ageText) ? Number(ageText) : NaN;
  const age = Number.isSafeInteger(parsedAge) && parsedAge >= 0 ? parsedAge : null;
  const ageSource = age === null ? null : "CK3_LIVE_RELATIVE_AGE";
  if (age === null) return { age, ageSource };
  const totalDays = nonnegativeNumber(gameData?.totalDays);
  const date = String(gameData?.date || "").trim();
  const sourceSnapshotId = date && totalDays !== null ? `${date}/${totalDays}` : null;
  const source = `${sourceOwnerId}.${field}`;
  return {
    age,
    ageSource,
    evidence: {
      age: [{
        value: age,
        ageSource,
        sourceOwnerId,
        relationType,
        source,
        campaignToken: typeof gameData?.campaignToken === "string" && gameData.campaignToken ? gameData.campaignToken : null,
        sourceSnapshotId
      }]
    }
  };
}

function hasCharacter(gameData, runtimeId) {
  const id = Number(runtimeId);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const characters = gameData?.characters;
  if (characters instanceof Map) return characters.has(id) || characters.has(String(id));
  return !!(characters && Object.hasOwn(characters, id));
}

function createLogParser({ GameData, Character, onGameDataParsed = null }) {
  async function parseLog(debugLogPath) {
    console.log(`parseLog: Processing debug log at path: ${debugLogPath}`);
    let gameData;
    let multiLineTempStorage = [];
    let isWaitingForMultiLine = false;
    let multiLineType = "";
    let currentRootID = 0;
    let currentTargetID = 0;
    let currentSecret = null;
    let currentKnownSecret = null;
    let currentTroops = null;
    let currentChild = null;
    let currentChildOwnerId = null;
    let currentSibling = null;
    let currentSiblingOwnerId = null;
    let pendingMemoryLine = null;
    let pendingLetterLine = null;
    const getSourceSnapshotId = () => gameData?.date && Number.isFinite(Number(gameData.totalDays))
      ? `${gameData.date}/${Number(gameData.totalDays)}`
      : null;
    const addBetrothalEvidence = (relative, sourceOwnerId, sourceRelation, targetId, targetName, targetPronoun) => {
      const targetGender = inferGenderFromPronoun(targetPronoun);
      const betrothed = {
        id: Number(targetId),
        name: String(targetName || "").trim(),
        sheHe: targetPronoun || "",
        gender: targetGender,
        ...(targetGender !== "unknown" ? { genderSource: "CK3_LIVE_RELATIVE" } : {}),
        relationType: "BETROTHED",
        source: "CK3_CURRENT_BETROTHAL",
        sourceOwnerId,
        relatedCharacterId: Number(relative.id),
        observerRuntimeId: sourceOwnerId,
        sourceRelation,
        evidenceScope: "SOURCE_OWNER_RECORD_ONLY",
        publicStatus: "CURRENT_BETROTHAL",
        knowledgeStatus: "UNKNOWN",
        campaignToken: gameData.campaignToken || null,
        sourceSnapshotId: getSourceSnapshotId(),
        evidenceConflict: false,
        targetBound: false
      };
      const hasOtherMaritalStatus = !["unmarried", "betrothed"].includes(relative.maritalStatus);
      if (hasOtherMaritalStatus) betrothed.evidenceConflict = true;
      if (!relative.betrothed) relative.betrothed = betrothed;
      else if (Number(relative.betrothed.id) !== betrothed.id || relative.betrothed.name !== betrothed.name
        || relative.betrothed.sheHe !== betrothed.sheHe || relative.betrothed.gender !== betrothed.gender
        || relative.betrothed.genderSource !== betrothed.genderSource
        || relative.betrothed.sourceOwnerId !== sourceOwnerId || relative.betrothed.sourceRelation !== sourceRelation
        || relative.betrothed.campaignToken !== betrothed.campaignToken || relative.betrothed.sourceSnapshotId !== betrothed.sourceSnapshotId) {
        relative.betrothed.evidenceConflict = true;
      }
    };
    const addCurrentSpouseEvidence = (relative, sourceOwnerId, sourceRelation, targetId, targetName, pronoun) => {
      if (!Array.isArray(relative.spouses)) relative.spouses = [];
      const gender = inferGenderFromPronoun(pronoun);
      const spouse = {
        id: Number(targetId),
        name: String(targetName || "").trim(),
        sheHe: pronoun || "",
        gender,
        ...(gender !== "unknown" ? { genderSource: "CK3_LIVE_RELATIVE" } : {}),
        relationType: "CURRENT_SPOUSE",
        source: "CK3_GAME_CURRENT_SPOUSE",
        sourceOwnerId,
        relatedCharacterId: Number(relative.id),
        observerRuntimeId: sourceOwnerId,
        sourceRelation,
        evidenceScope: "SOURCE_OWNER_RECORD_ONLY",
        publicStatus: "PUBLIC_LEGAL_MARRIAGE",
        knowledgeStatus: "UNKNOWN",
        campaignToken: gameData.campaignToken || null,
        sourceSnapshotId: getSourceSnapshotId(),
        evidenceConflict: false,
        targetBound: false
      };
      const existing = relative.spouses.find(item => Number(item?.id) === spouse.id);
      if (!existing) relative.spouses.push(spouse);
      else if (existing.name !== spouse.name || existing.gender !== spouse.gender || existing.sourceRelation !== sourceRelation
        || existing.campaignToken !== spouse.campaignToken || existing.sourceSnapshotId !== spouse.sourceSnapshotId) {
        existing.evidenceConflict = true;
        spouse.evidenceConflict = true;
        relative.spouses.push(spouse);
      }
    };
    const fileStream = fs.createReadStream(debugLogPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    for await (const rawLine of rl) {
      let line = rawLine;
      if (pendingLetterLine) {
        if (line.includes("VOTC:") || /^\[.*\]\[.*\]/.test(line)) pendingLetterLine = null;
        else line = `${pendingLetterLine}\n${line}`;
      }
      if (line.includes("VOTC:LETTER/;/")) {
        if (line.split("/;/").length < 5) {
          pendingLetterLine = line;
          continue;
        }
        pendingLetterLine = null;
      }
      if (pendingMemoryLine) {
        if (line.includes("VOTC:") || /^\[.*\]\[.*\]/.test(line)) pendingMemoryLine = null;
        else line = `${pendingMemoryLine}\n${line}`;
      }
      if (line.includes("VOTC:IN/;/memory/;/")) {
        if (!/\/;\/-?\d+(?:\.\d+)?\/;\/\d+\s*$/.test(line)) {
          pendingMemoryLine = line;
          continue;
        }
        pendingMemoryLine = null;
      }
      if (isWaitingForMultiLine) {
        let value = line.split("#")[0];
        switch (multiLineType) {
          case "new_relations":
            value = removeTooltip(value);
            multiLineTempStorage.push(value);
            break;
          case "relations":
            multiLineTempStorage.push(removeTooltip(value));
            break;
          case "opinionBreakdown":
            multiLineTempStorage.push(parseOpinionModifier(value));
            break;
          case "income":
          case "treasury":
          case "influence":
          case "herd":
            multiLineTempStorage.push(removeTooltip(value));
            break;
        }
        if (line.includes("#ENDMULTILINE")) {
          const fullContent = multiLineTempStorage.join("\n");
          if (multiLineType === "income" && gameData.characters.get(currentRootID).income) {
            gameData.characters.get(currentRootID).income.balanceBreakdown = fullContent;
          } else if (multiLineType === "treasury" && gameData.characters.get(currentRootID).treasury) {
            gameData.characters.get(currentRootID).treasury.tooltip = fullContent;
          } else if (multiLineType === "influence" && gameData.characters.get(currentRootID).influence) {
            gameData.characters.get(currentRootID).influence.tooltip = fullContent;
          } else if (multiLineType === "herd" && gameData.characters.get(currentRootID).herd) {
            gameData.characters.get(currentRootID).herd.breakdown = fullContent;
          }
          isWaitingForMultiLine = false;
        }
        continue;
      }
      if (line.includes("VOTC:LETTER/;/")) {
        if (gameData) {
          const parts = line.split("/;/").slice(1).map(removeTooltip);
          let letterData = null;
          letterData = {
            content: parts[0],
            letterId: parts[1],
            totalDays: Number(parts[2]),
            delay: Number(parts[3])
          };
          if (letterData) {
            gameData.letterData = letterData;
          }
        }
        continue;
      }
      if (line.includes("VOTC:CAMPAIGN/")) {
        const campaignMatch = line.match(/VOTC:CAMPAIGN\/(votc8c-[0-9]{12})(?![A-Za-z0-9_-])/);
        if (gameData) gameData.campaignToken = campaignMatch ? campaignMatch[1] : null;
        continue;
      }
      if (line.includes("VOTC:IN")) {
        let data = line.split("/;/");
        const dataType = data[1];
        data.splice(0, 2);
        const rootID = Number(data[0]);
        currentRootID = rootID;
        for (let i = 0; i < data.length; i++) {
          data[i] = dataType === "memory" && i === 3 ? removeMemoryMarkup(data[i]) : removeTooltip(data[i]);
        }
        switch (dataType) {
          case "init":
            gameData = new GameData(data);
            break;
          case "character":
            let char = new Character(data);
            gameData.characters.set(char.id, char);
            break;
          case "memory":
            let memory = parseMemory(data);
            gameData?.characters.get(rootID)?.memories.push(memory);
            break;
          case "secret":
            currentSecret = parseSecretStart(data);
            break;
          case "secret_is_criminal":
            if (currentSecret) currentSecret.isCriminal = true;
            break;
          case "secret_is_shunned":
            if (currentSecret) currentSecret.isShunned = true;
            break;
          case "secret_target":
            if (currentSecret) {
              currentSecret.target = {
                id: Number(data[1]),
                name: data[2]
              };
            }
            break;
          case "secret_knower":
            if (currentSecret) {
              if (!currentSecret.knowers) currentSecret.knowers = [];
              currentSecret.knowers.push({
                id: Number(data[2]),
                name: data[3],
                isSpent: false,
                canBeExposed: false
              });
            }
            break;
          case "secret_spent":
            if (currentSecret && currentSecret.knowers && currentSecret.knowers.length > 0) {
              const lastKnower = currentSecret.knowers[currentSecret.knowers.length - 1];
              lastKnower.isSpent = data[1] === "yes";
            }
            break;
          case "secret_can_be_exposed":
            if (currentSecret && currentSecret.knowers && currentSecret.knowers.length > 0) {
              const lastKnower = currentSecret.knowers[currentSecret.knowers.length - 1];
              lastKnower.canBeExposed = data[1] === "yes";
            }
            break;
          case "secret_eob":
            if (currentSecret) {
              const secret = {
                name: currentSecret.name || "",
                desc: currentSecret.desc || "",
                category: currentSecret.category || "",
                type: currentSecret.type || "",
                isCriminal: currentSecret.isCriminal || false,
                isShunned: currentSecret.isShunned || false,
                target: currentSecret.target,
                knowers: currentSecret.knowers || []
              };
              gameData.characters.get(rootID).secrets.push(secret);
              currentSecret = null;
            }
            break;
          case "k_secret":
            currentKnownSecret = parseKnownSecretStart(data);
            break;
          case "k_secret_owner":
            if (currentKnownSecret) {
              currentKnownSecret.ownerId = Number(data[1]);
              currentKnownSecret.ownerName = data[2];
            }
            break;
          case "k_secret_is_criminal":
            if (currentKnownSecret) currentKnownSecret.isCriminal = true;
            break;
          case "k_secret_is_shunned":
            if (currentKnownSecret) currentKnownSecret.isShunned = true;
            break;
          case "k_secret_target":
            if (currentKnownSecret) {
              currentKnownSecret.target = {
                id: Number(data[1]),
                name: data[2]
              };
            }
            break;
          case "k_secret_spent":
            if (currentKnownSecret) {
              currentKnownSecret.isSpent = data[1] === "yes";
            }
            break;
          case "k_secret_can_be_exposed":
            if (currentKnownSecret) {
              currentKnownSecret.canBeExposed = data[1] === "yes";
            }
            break;
          case "k_secret_knower":
            if (currentKnownSecret) {
              if (!currentKnownSecret.knowers) currentKnownSecret.knowers = [];
              currentKnownSecret.knowers.push({
                id: Number(data[2]),
                name: data[3],
                isSpent: false,
                // Not applicable for known secrets
                canBeExposed: false
                // Not applicable for known secrets
              });
            }
            break;
          case "k_secret_eob":
            if (currentKnownSecret) {
              const knownSecret = {
                name: currentKnownSecret.name || "",
                desc: currentKnownSecret.desc || "",
                category: currentKnownSecret.category || "",
                type: currentKnownSecret.type || "",
                ownerId: currentKnownSecret.ownerId || 0,
                ownerName: currentKnownSecret.ownerName || "",
                isCriminal: currentKnownSecret.isCriminal || false,
                isShunned: currentKnownSecret.isShunned || false,
                target: currentKnownSecret.target,
                isSpent: currentKnownSecret.isSpent || false,
                canBeExposed: currentKnownSecret.canBeExposed || false,
                knowers: currentKnownSecret.knowers || []
              };
              gameData.characters.get(rootID).knownSecrets.push(knownSecret);
              currentKnownSecret = null;
            }
            break;
          case "modifier":
            const modifier = {
              id: data[1],
              name: data[2],
              description: data[3]
            };
            gameData.characters.get(rootID).modifiers.push(modifier);
            break;
          case "stress":
            const stress = {
              value: Number(data[1]),
              level: Number(data[2]),
              progress: Number(data[3])
            };
            gameData.characters.get(rootID).stress = stress;
            break;
          case "legitimacy":
            if (data[1] === "no") {
              gameData.characters.get(rootID).legitimacy = void 0;
            } else {
              const legitimacy = {
                value: Number(data[1]),
                level: Number(data[2]),
                type: data[3],
                avgPowerfulVassalExpectation: Number(data[4]),
                avgVassalExpectation: Number(data[5]),
                liegeExpectation: Number(data[6])
              };
              gameData.characters.get(rootID).legitimacy = legitimacy;
            }
            break;
          case "levies_vassals":
            if (!currentTroops) {
              currentTroops = {
                leviesVassals: 0,
                leviesDomain: [],
                leviesTheocratic: 0,
                maaRegiments: []
              };
            }
            currentTroops.leviesVassals = Number(data[1]);
            break;
          case "levies_dom":
            if (!currentTroops) {
              currentTroops = {
                leviesVassals: 0,
                leviesDomain: [],
                leviesTheocratic: 0,
                maaRegiments: []
              };
            }
            if (!currentTroops.leviesDomain) {
              currentTroops.leviesDomain = [];
            }
            currentTroops.leviesDomain.push(Number(data[1]));
            break;
          case "levies_theo":
            if (!currentTroops) {
              currentTroops = {
                leviesVassals: 0,
                leviesDomain: [],
                leviesTheocratic: 0,
                maaRegiments: []
              };
            }
            currentTroops.leviesTheocratic = Number(data[1]);
            break;
          case "maa":
            if (!currentTroops) {
              currentTroops = {
                leviesVassals: 0,
                leviesDomain: [],
                leviesTheocratic: 0,
                maaRegiments: []
              };
            }
            if (!currentTroops.maaRegiments) {
              currentTroops.maaRegiments = [];
            }
            const regiment = {
              name: data[1],
              isPersonal: data[2] === "1",
              menAlive: Number(data[3])
            };
            currentTroops.maaRegiments.push(regiment);
            break;
          case "laws":
            if (data[1] === "") {
              break;
            }
            const law = {
              name: data[1]
            };
            gameData.characters.get(rootID).laws.push(law);
            break;
          case "troops_eob":
            if (currentTroops) {
              const leviesDomainSum = (currentTroops.leviesDomain || []).reduce((sum, val) => sum + val, 0);
              const personalMAATotal = (currentTroops.maaRegiments || []).filter((regiment2) => regiment2.isPersonal).reduce((sum, regiment2) => sum + regiment2.menAlive, 0);
              const totalOwnedTroops = leviesDomainSum + (currentTroops.leviesTheocratic || 0) + personalMAATotal;
              const troops = {
                leviesVassals: currentTroops.leviesVassals || 0,
                leviesDomain: currentTroops.leviesDomain || [],
                leviesDomainSum,
                leviesTheocratic: currentTroops.leviesTheocratic || 0,
                maaRegiments: currentTroops.maaRegiments || [],
                totalOwnedTroops
              };
              gameData.characters.get(rootID).troops = troops;
              currentTroops = null;
            }
            break;
          case "income":
            if (line.split("#")[1] !== "") {
              const income = {
                gold: Number(data[1]),
                balance: Number(data[2]),
                balanceBreakdown: removeTooltip(line.split("#")[1])
              };
              const character = gameData.characters.get(rootID);
              character.income = income;
              if (Number.isFinite(income.gold)) character.gold = Math.floor(income.gold);
            }
            if (!line.includes("#ENDMULTILINE")) {
              multiLineTempStorage = [gameData.characters.get(rootID).income.balanceBreakdown];
              isWaitingForMultiLine = true;
              multiLineType = "income";
            }
            break;
          case "treasury":
            if (line.split("#")[1] !== "") {
              const treasury = {
                amount: Number(data[1]),
                tooltip: removeTooltip(line.split("#")[1])
              };
              gameData.characters.get(rootID).treasury = treasury;
            }
            if (!line.includes("#ENDMULTILINE")) {
              multiLineTempStorage = [gameData.characters.get(rootID).treasury.tooltip];
              isWaitingForMultiLine = true;
              multiLineType = "treasury";
            }
            break;
          case "influence":
            if (line.split("#")[1] !== "") {
              const influence = {
                amount: Number(data[1]),
                tooltip: removeTooltip(line.split("#")[1])
              };
              gameData.characters.get(rootID).influence = influence;
            }
            if (!line.includes("#ENDMULTILINE")) {
              multiLineTempStorage = [gameData.characters.get(rootID).influence.tooltip];
              isWaitingForMultiLine = true;
              multiLineType = "influence";
            }
            break;
          case "herd":
            if (line.split("#")[1] !== "") {
              const herd = {
                amount: Number(data[1]),
                breakdown: removeTooltip(line.split("#")[1])
              };
              gameData.characters.get(rootID).herd = herd;
            }
            if (!line.includes("#ENDMULTILINE")) {
              multiLineTempStorage = [gameData.characters.get(rootID).herd.breakdown];
              isWaitingForMultiLine = true;
              multiLineType = "herd";
            }
            break;
          case "trait":
            gameData.characters.get(rootID).traits.push(parseTrait(data));
            break;
          case "opinions": {
            const opinions = gameData.characters.get(rootID).opinions;
            const current = opinions.find(item => item.id === Number(data[1]));
            if (current) current.opinon = Number(data[2]);
            else opinions.push({ id: Number(data[1]), opinon: Number(data[2]) });
            break;
          }
          case "relations":
            if (line.split("#")[1] !== "") {
              gameData.characters.get(rootID).relationsToPlayer = [removeTooltip(line.split("#")[1])];
            }
            if (!line.includes("#ENDMULTILINE")) {
              multiLineTempStorage = gameData.characters.get(rootID).relationsToPlayer;
              isWaitingForMultiLine = true;
              multiLineType = "relations";
            }
            break;
          case "new_relations": {
            const tmpTargetId = Number(data[1]);
            const ch = gameData.characters.get(rootID);
            if (!ch || Number.isNaN(tmpTargetId)) break;
            const relObj = { id: tmpTargetId, relations: [] };
            ch.relationsToCharacters.push(relObj);
            const firstChunk = line.split("#")[1] ?? "";
            const cleaned = removeTooltip(firstChunk).trim();
            if (cleaned) relObj.relations.push(cleaned);
            if (!line.includes("#ENDMULTILINE")) {
              multiLineTempStorage = relObj.relations;
              isWaitingForMultiLine = true;
              multiLineType = "new_relations";
            }
            break;
          }
          case "opinionBreakdown":
            currentTargetID = Number(data[1]);
            let breakdownEntry = gameData.characters.get(rootID).opinionBreakdowns.find((ob) => ob.id === currentTargetID);
            if (!breakdownEntry) {
              breakdownEntry = { id: currentTargetID, breakdown: [] };
              gameData.characters.get(rootID).opinionBreakdowns.push(breakdownEntry);
            }
            if (line.split("#")[1] !== "") {
              breakdownEntry.breakdown = [parseOpinionModifier(line.split("#")[1])];
            }
            if (!line.includes("#ENDMULTILINE")) {
              multiLineTempStorage = breakdownEntry.breakdown;
              isWaitingForMultiLine = true;
              multiLineType = "opinionBreakdown";
            }
            break;
          case "parents": {
            const parentId = Number(data[1]);
            const gender = inferGenderFromPronoun(data[6]);
            const parent = {
              id: parentId,
              name: data[2],
              birthDateTotalDays: nonnegativeNumber(data[3]),
              birthDate: data[4],
              gender,
              ...(gender !== "unknown" ? { genderSource: "CK3_LIVE_RELATIVE" } : {}),
              sheHe: data[6] || "",
              ...(data[7] === "PUBLIC_LEGAL_PARENT" || data[7] === "UNKNOWN" ? {
                source: "CK3_DIRECT_PARENT",
                sourceOwnerId: rootID,
                childId: rootID,
                relationType: "parent",
                sourceRelation: "parents",
                publicStatus: data[7] === "PUBLIC_LEGAL_PARENT" ? "PUBLIC_LEGAL_PARENT" : "UNKNOWN",
                knowledgeStatus: "UNKNOWN",
                campaignToken: gameData.campaignToken || null,
                sourceSnapshotId: getSourceSnapshotId()
              } : { publicStatus: "UNKNOWN" }),
              spouses: [],
              ...parseRelativeAge(data, 5, gameData, rootID, "parent", "parents")
            };
            gameData.characters.get(rootID)?.parents.push(parent);
            break;
          }
          case "parent_spouse": {
            const parentId = Number(data[1]);
            const spouseId = Number(data[2]);
            const character = gameData.characters.get(rootID);
            const parent = character?.parents?.find((item) => Number(item.id) === parentId
              && item.publicStatus === "PUBLIC_LEGAL_PARENT"
              && item.source === "CK3_DIRECT_PARENT"
              && Number(item.sourceOwnerId) === rootID
              && Number(item.childId) === rootID
              && item.relationType === "parent"
              && item.sourceRelation === "parents"
              && item.campaignToken === gameData.campaignToken
              && item.sourceSnapshotId === getSourceSnapshotId());
            const spouseGender = inferGenderFromPronoun(data[4]);
            if (!parent || !gameData.campaignToken || !getSourceSnapshotId()
              || !Number.isSafeInteger(spouseId) || spouseId <= 0 || spouseId === rootID || spouseId === parentId
              || !String(data[3] || "").trim() || data[5] !== "PUBLIC_LEGAL_MARRIAGE") break;
            const spouse = {
              id: spouseId,
              name: data[3],
              sheHe: data[4] || "",
              gender: spouseGender,
              ...(spouseGender !== "unknown" ? { genderSource: "CK3_LIVE_RELATIVE" } : {}),
              relationType: "CURRENT_SPOUSE",
              parentId,
              relatedCharacterId: parentId,
              sourceOwnerId: rootID,
              observerRuntimeId: rootID,
              source: "CK3_PARENT_SPOUSE",
              sourceRelation: "parents.spouses",
              evidenceScope: "SOURCE_OWNER_RECORD_ONLY",
              publicStatus: "PUBLIC_LEGAL_MARRIAGE",
              knowledgeStatus: "UNKNOWN",
              evidenceConflict: false,
              campaignToken: gameData.campaignToken || null,
              sourceSnapshotId: getSourceSnapshotId(),
              children: []
            };
            const existing = parent.spouses.find((item) => Number(item.id) === spouseId);
            if (!existing) parent.spouses.push(spouse);
            else if (existing.name !== spouse.name || existing.gender !== spouse.gender
              || existing.source !== spouse.source || existing.publicStatus !== spouse.publicStatus) existing.evidenceConflict = true;
            break;
          }
          case "parent_spouse_child": {
            const parentId = Number(data[1]);
            const spouseId = Number(data[2]);
            const childId = Number(data[3]);
            const otherParentId = Number(data[6]);
            const character = gameData.characters.get(rootID);
            const parent = character?.parents?.find((item) => Number(item.id) === parentId
              && item.publicStatus === "PUBLIC_LEGAL_PARENT"
              && item.source === "CK3_DIRECT_PARENT"
              && Number(item.sourceOwnerId) === rootID
              && Number(item.childId) === rootID
              && item.relationType === "parent"
              && item.sourceRelation === "parents"
              && item.campaignToken === gameData.campaignToken
              && item.sourceSnapshotId === getSourceSnapshotId());
            const spouse = parent?.spouses?.find((item) => Number(item.id) === spouseId
              && item.relationType === "CURRENT_SPOUSE"
              && item.source === "CK3_PARENT_SPOUSE"
              && Number(item.sourceOwnerId) === rootID
              && Number(item.parentId) === parentId
              && item.sourceRelation === "parents.spouses"
              && item.publicStatus === "PUBLIC_LEGAL_MARRIAGE"
              && item.campaignToken === gameData.campaignToken
              && item.sourceSnapshotId === getSourceSnapshotId());
            const childGender = inferGenderFromPronoun(data[5]);
            const otherParentGender = inferGenderFromPronoun(data[8]);
            if (!spouse || !gameData.campaignToken || !getSourceSnapshotId()
              || !Number.isSafeInteger(childId) || childId <= 0 || childId === rootID || childId === spouseId
              || !Number.isSafeInteger(otherParentId) || otherParentId <= 0 || otherParentId === childId || otherParentId === spouseId
              || !String(data[4] || "").trim() || !String(data[7] || "").trim() || data[9] !== "PUBLIC_LEGAL_PARENT") break;
            const child = {
              id: childId,
              name: data[4],
              sheHe: data[5] || "",
              gender: childGender,
              ...(childGender !== "unknown" ? { genderSource: "CK3_LIVE_RELATIVE" } : {}),
              sourceOwnerId: rootID,
              sourceParentId: parentId,
              sourceSpouseId: spouseId,
              relationType: "child",
              source: "CK3_PARENT_SPOUSE_CHILD",
              sourceRelation: "parents.spouses.children",
              publicStatus: "PUBLIC_LEGAL_PARENT",
              knowledgeStatus: "UNKNOWN",
              campaignToken: gameData.campaignToken || null,
              sourceSnapshotId: getSourceSnapshotId(),
              parents: [
                {
                  id: spouseId,
                  name: spouse.name,
                  gender: spouse.gender,
                  sourceOwnerId: rootID,
                  childId,
                  relationType: "parent",
                  source: "CK3_PARENT_SPOUSE_CHILD",
                  sourceRelation: "parents.spouses.children.spouseParent",
                  publicStatus: "PUBLIC_LEGAL_PARENT",
                  knowledgeStatus: "UNKNOWN",
                  campaignToken: gameData.campaignToken || null,
                  sourceSnapshotId: getSourceSnapshotId()
                },
                {
                  id: otherParentId,
                  name: data[7],
                  gender: otherParentGender,
                  ...(otherParentGender !== "unknown" ? { genderSource: "CK3_LIVE_RELATIVE" } : {}),
                  sourceOwnerId: rootID,
                  childId,
                  relationType: "parent",
                  source: "CK3_PARENT_SPOUSE_CHILD",
                  sourceRelation: "parents.spouses.children.otherParent",
                  publicStatus: "PUBLIC_LEGAL_PARENT",
                  knowledgeStatus: "UNKNOWN",
                  campaignToken: gameData.campaignToken || null,
                  sourceSnapshotId: getSourceSnapshotId()
                }
              ]
            };
            const existing = spouse.children.find((item) => Number(item.id) === childId);
            if (!existing) spouse.children.push(child);
            else if (JSON.stringify(existing.parents) !== JSON.stringify(child.parents)
              || existing.name !== child.name || existing.gender !== child.gender) existing.evidenceConflict = true;
            break;
          }
          case "parent_death":
            const parentId = Number(data[1]);
            const parentToUpdate = gameData.characters.get(rootID).parents.find((p) => p.id === parentId);
            if (parentToUpdate) {
              parentToUpdate.deathDateTotalDays = Number(data[2]);
              parentToUpdate.deathDate = data[3];
              parentToUpdate.deathReason = data[4];
            }
            break;
          case "current_spouse": {
            const character = gameData.characters.get(rootID);
            if (character && data[4] === "PUBLIC_LEGAL_MARRIAGE") {
              addCurrentSpouseEvidence(character, rootID, "spouses", data[1], data[2], data[3]);
            }
            break;
          }
          case "former_spouse": {
            const character = gameData.characters.get(rootID);
            const spouseId = Number(data[1]);
            if (!character) break;
            if (!Array.isArray(character.formerSpouses)) character.formerSpouses = [];
            const spouse = {
              id: spouseId,
              name: String(data[2] || "").trim(),
              sheHe: data[3] || "",
              gender: inferGenderFromPronoun(data[3]),
              ...(inferGenderFromPronoun(data[3]) !== "unknown" ? { genderSource: "CK3_LIVE_RELATIVE" } : {}),
              relationType: "FORMER_SPOUSE",
              source: "CK3_FORMER_SPOUSE",
              sourceOwnerId: rootID,
              sourceRelation: "formerSpouses",
              publicStatus: "FORMER_SPOUSE",
              knowledgeStatus: "UNKNOWN",
              historicalStatus: "FORMER",
              campaignToken: gameData.campaignToken || null,
              sourceSnapshotId: getSourceSnapshotId(),
              evidenceConflict: false,
              targetBound: false
            };
            const existing = character.formerSpouses.find(item => Number(item?.id) === spouseId);
            if (!existing) character.formerSpouses.push(spouse);
            else if (existing.name !== spouse.name || existing.sheHe !== spouse.sheHe || existing.gender !== spouse.gender
              || existing.source !== spouse.source
              || existing.campaignToken !== spouse.campaignToken || existing.sourceSnapshotId !== spouse.sourceSnapshotId) {
              existing.evidenceConflict = true;
              spouse.evidenceConflict = true;
              character.formerSpouses.push(spouse);
            }
            break;
          }
          case "kids":
            currentChild = {
              id: Number(data[1]),
              name: data[2],
              sheHe: data[3],
              gender: inferGenderFromPronoun(data[3]),
              genderSource: "CK3_LIVE_RELATIVE",
              birthDateTotalDays: nonnegativeNumber(data[4]),
              birthDate: data[5],
              ...(data[7] === "PUBLIC_LEGAL_PARENT" || data[7] === "UNKNOWN" ? {
                directParentEvidence: {
                  source: "CK3_DIRECT_PARENT",
                  sourceOwnerId: Number(data[1]),
                  childId: Number(data[1]),
                  parentId: rootID,
                  relationType: "parent",
                  sourceRelation: "parents",
                  publicStatus: data[7],
                  knowledgeStatus: "UNKNOWN",
                  campaignToken: gameData.campaignToken || null,
                  sourceSnapshotId: getSourceSnapshotId()
                }
              } : {}),
              ...parseRelativeAge(data, 6, gameData, rootID, "child", "children"),
              traits: [],
              maritalStatus: "unmarried",
              concubines: [],
              spouses: []
            };
            currentChildOwnerId = rootID;
            const existingChildren = gameData.characters.get(rootID).children.filter((child) => Number(child?.id) === currentChild.id);
            if (existingChildren.some((child) => child?.directParentEvidence || currentChild.directParentEvidence)) {
              for (const child of existingChildren) {
                const previousEvidence = child.directParentEvidence;
                const currentEvidence = currentChild.directParentEvidence;
                if (!previousEvidence || !currentEvidence || JSON.stringify(previousEvidence) !== JSON.stringify(currentEvidence)) {
                  if (previousEvidence) child.directParentEvidence = { ...previousEvidence, evidenceConflict: true };
                  if (currentEvidence) currentChild.directParentEvidence = { ...currentEvidence, evidenceConflict: true };
                }
              }
            }
            gameData.characters.get(rootID).children.push(currentChild);
            break;
          case "kid_other_parent":
            if (currentChild && currentChildOwnerId === rootID && Number(data[1]) === Number(currentChild.id)) {
              currentChild.otherParent = {
                id: Number(data[2]),
                otherParentId: Number(data[2]),
                name: data[3],
                parentGender: inferGenderFromPronoun(data[5]),
                sourceOwnerId: rootID,
                relationType: "parent",
                source: "CK3_OTHER_PARENT",
                sourceRelation: "kids.otherParent",
                publicStatus: data[4] === "PUBLIC_LEGAL_PARENT" ? "PUBLIC_LEGAL_PARENT" : "UNKNOWN",
                knowledgeStatus: "UNKNOWN",
                campaignToken: gameData.campaignToken || null,
                sourceSnapshotId: getSourceSnapshotId()
              };
            }
            break;
          case "kid_trait":
            if (currentChild && currentChild.traits) {
              currentChild.traits.push(parseTrait(data, true));
            }
            break;
          case "kid_is_concubine":
            if (currentChild) {
              if (currentChild.betrothed) currentChild.betrothed.evidenceConflict = true;
              currentChild.maritalStatus = "concubine";
              currentChild.concubineOf = {
                id: Number(data[2]),
                name: data[3]
              };
            }
            break;
          case "kid_concubine":
            if (currentChild) {
              if (currentChild.betrothed) currentChild.betrothed.evidenceConflict = true;
              currentChild.maritalStatus = "has_concubines";
              if (!currentChild.concubines) currentChild.concubines = [];
              currentChild.concubines.push({
                id: Number(data[2]),
                name: data[3]
              });
            }
            break;
          case "kid_spouse":
            if (currentChild && currentChildOwnerId === rootID && Number(data[1]) === Number(currentChild.id)) {
              if (currentChild.betrothed) currentChild.betrothed.evidenceConflict = true;
              currentChild.maritalStatus = "has_spouses";
              if (data[5] === "PUBLIC_LEGAL_MARRIAGE") addCurrentSpouseEvidence(currentChild, currentChildOwnerId, "kids.spouses", data[2], data[3], data[4]);
              else currentChild.spouses.push({ id: Number(data[2]), name: data[3] });
            }
            break;
          case "kid_betrothed":
            if (currentChild && currentChildOwnerId === rootID && Number(data[1]) === Number(currentChild.id)) {
              addBetrothalEvidence(currentChild, currentChildOwnerId, "kids.betrothed", data[2], data[3], data[4]);
              currentChild.maritalStatus = "betrothed";
            }
            break;
          case "kid_unmarried":
            if (currentChild) {
              currentChild.maritalStatus = "unmarried";
            }
            break;
          case "kid_death":
            if (currentChild) {
              currentChild.deathDateTotalDays = Number(data[2]);
              currentChild.deathDate = data[3];
              currentChild.deathReason = data[4];
            }
            break;
          case "kid_eob":
            currentChild = null;
            currentChildOwnerId = null;
            break;
          case "siblings":
            currentSibling = {
              id: Number(data[1]),
              name: data[2],
              sheHe: data[3],
              gender: inferGenderFromPronoun(data[3]),
              genderSource: "CK3_LIVE_RELATIVE",
              birthDateTotalDays: nonnegativeNumber(data[4]),
              birthDate: data[5],
              ...parseRelativeAge(data, 6, gameData, rootID, "sibling", "siblings"),
              traits: [],
              maritalStatus: "unmarried",
              concubines: [],
              spouses: []
            };
            currentSiblingOwnerId = rootID;
            gameData.characters.get(rootID).siblings.push(currentSibling);
            break;
          case "sibling_other_parent":
            if (currentSibling && currentSiblingOwnerId === rootID && Number(data[1]) === Number(currentSibling.id)) {
              currentSibling.otherParent = {
                id: Number(data[2]),
                otherParentId: Number(data[2]),
                name: data[3],
                parentGender: inferGenderFromPronoun(data[5]),
                sourceOwnerId: rootID,
                relationType: "parent",
                source: "CK3_OTHER_PARENT",
                sourceRelation: "siblings.otherParent",
                publicStatus: data[4] === "PUBLIC_LEGAL_PARENT" ? "PUBLIC_LEGAL_PARENT" : "UNKNOWN",
                knowledgeStatus: "UNKNOWN",
                campaignToken: gameData.campaignToken || null,
                sourceSnapshotId: getSourceSnapshotId()
              };
            }
            break;
          case "sibling_trait":
            if (currentSibling && currentSibling.traits) {
              currentSibling.traits.push(parseTrait(data, true));
            }
            break;
          case "sibling_is_concubine":
            if (currentSibling) {
              if (currentSibling.betrothed) currentSibling.betrothed.evidenceConflict = true;
              currentSibling.maritalStatus = "concubine";
              currentSibling.concubineOf = {
                id: Number(data[2]),
                name: data[3]
              };
            }
            break;
          case "sibling_concubine":
            if (currentSibling) {
              if (currentSibling.betrothed) currentSibling.betrothed.evidenceConflict = true;
              currentSibling.maritalStatus = "has_concubines";
              if (!currentSibling.concubines) currentSibling.concubines = [];
              currentSibling.concubines.push({
                id: Number(data[2]),
                name: data[3]
              });
            }
            break;
          case "sibling_spouse":
            if (currentSibling && currentSiblingOwnerId === rootID && Number(data[1]) === Number(currentSibling.id)) {
              if (currentSibling.betrothed) currentSibling.betrothed.evidenceConflict = true;
              currentSibling.maritalStatus = "has_spouses";
              if (data[5] === "PUBLIC_LEGAL_MARRIAGE") addCurrentSpouseEvidence(currentSibling, currentSiblingOwnerId, "siblings.spouses", data[2], data[3], data[4]);
              else currentSibling.spouses.push({ id: Number(data[2]), name: data[3] });
            }
            break;
          case "sibling_betrothed":
            if (currentSibling && currentSiblingOwnerId === rootID && Number(data[1]) === Number(currentSibling.id)) {
              addBetrothalEvidence(currentSibling, currentSiblingOwnerId, "siblings.betrothed", data[2], data[3], data[4]);
              currentSibling.maritalStatus = "betrothed";
            }
            break;
          case "sibling_unmarried":
            if (currentSibling) {
              currentSibling.maritalStatus = "unmarried";
            }
            break;
          case "sibling_death":
            if (currentSibling) {
              currentSibling.deathDateTotalDays = Number(data[2]);
              currentSibling.deathDate = data[3];
              currentSibling.deathReason = data[4];
            }
            break;
          case "sibling_eob":
            currentSibling = null;
            currentSiblingOwnerId = null;
            break;
          case "persona_numbers":
            const character = gameData.characters.get(rootID);
            if (character) {
              character.boldness = Number(data[1]);
              character.compassion = Number(data[2]);
              character.energy = Number(data[3]);
              character.greed = Number(data[4]);
              character.honor = Number(data[5]);
              character.rationality = Number(data[6]);
              character.sociability = Number(data[7]);
              character.vengefulness = Number(data[8]);
              character.zeal = Number(data[9]);
            }
            break;
        }
      }
    }
    function parseMemory(data) {
      const memory = {
        type: data[1],
        creationDate: data[2],
        desc: data[3],
        relevanceWeight: Number(data[4]),
        creationDateTotalDays: Number(data[5])
      };
      return memory;
    }
    function parseSecretStart(data) {
      return {
        name: data[1],
        desc: data[2],
        category: data[3],
        type: data[4] || "",
        isCriminal: false,
        isShunned: false,
        knowers: []
      };
    }
    function parseKnownSecretStart(data) {
      return {
        name: data[1],
        desc: data[2],
        category: data[3],
        type: data[4] || "",
        isCriminal: false,
        isShunned: false,
        isSpent: false,
        canBeExposed: false,
        knowers: []
      };
    }
    function parseTrait(data, relative = false) {
      const categoryIndex = relative ? 2 : 1;
      const legacyLength = relative ? 5 : 4;
      const hasTraitId = data.length > legacyLength;
      const offset = hasTraitId ? 1 : 0;
      const name = data[categoryIndex + offset + 1];
      const trait = {
        category: data[categoryIndex + offset],
        name,
        desc: data[categoryIndex + offset + 2]
      };
      if (hasTraitId) {
        trait.traitId = data[categoryIndex];
        trait.localizedName = name;
      }
      return trait;
    }
    function parseOpinionModifier(line) {
      line = line.replace(/ *\([^)]*\) */g, "");
      let splits = line.split(": ");
      for (let i = 0; i < splits.length; i++) {
        splits[i] = removeTooltip(splits[i]);
      }
      return {
        reason: splits[0],
        value: Number(splits[1])
      };
    }
    if (gameData) {
      const characterValues = gameData.characters instanceof Map ? [...gameData.characters.values()] : Object.values(gameData.characters || {});
      for (const character of characterValues) {
        for (const spouse of character?.spouses || []) {
          spouse.targetBound = hasCharacter(gameData, spouse.id);
        }
        for (const relative of [...(character?.children || []), ...(character?.siblings || [])]) {
          for (const spouse of relative?.spouses || []) {
            spouse.targetBound = hasCharacter(gameData, spouse.id);
          }
          if (relative?.betrothed) relative.betrothed.targetBound = hasCharacter(gameData, relative.betrothed.id);
        }
        for (const parent of character?.parents || []) {
          for (const spouse of parent?.spouses || []) spouse.targetBound = hasCharacter(gameData, spouse.id);
        }
        for (const formerSpouse of character?.formerSpouses || []) {
          formerSpouse.targetBound = hasCharacter(gameData, formerSpouse.id);
        }
      }
    }
    if (gameData) Object.defineProperty(gameData, "ck3RelationshipReadbackComplete", {
      value: !(isWaitingForMultiLine && ["relations", "new_relations"].includes(multiLineType)),
      configurable: true
    });
    if (gameData && typeof onGameDataParsed === "function") await onGameDataParsed(gameData);
    console.log(gameData);
    return gameData;
  }
  function removeTooltip(str) {
    let newWords = [];
    str.split(" ").forEach((word) => {
      if (word.includes("")) {
        newWords.push(word.split("")[0]);
      } else {
        newWords.push(word);
      }
    });
    return newWords.join(" ").replace(/ +(?= )/g, "").trim();
  }

  function removeMemoryMarkup(str) {
    const text = str.replace(/\u0015(?:ONCLICK|TOOLTIP):[^\u0015]*/g, "")
      .replace(/\u0015L;?[ \t]*/g, "")
      .replace(/\u0015!/g, "");
    return text.includes("\u0015") ? "" : text.replace(/[ \t]{2,}/g, " ").trim();
  }
  
  return parseLog;
}

module.exports = { createLogParser };
