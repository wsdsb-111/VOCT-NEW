"use strict";

const fs = require("fs");
const readline = require("readline");

function createLogParser({ GameData, Character }) {
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
    let currentSibling = null;
    const fileStream = fs.createReadStream(debugLogPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    for await (const line of rl) {
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
      if (line.includes("VOTC:LETTER") && !line.includes("delay") && !line.includes("set to thread")) {
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
      if (line.includes("VOTC:IN")) {
        let data = line.split("/;/");
        const dataType = data[1];
        data.splice(0, 2);
        const rootID = Number(data[0]);
        currentRootID = rootID;
        for (let i = 0; i < data.length; i++) {
          data[i] = removeTooltip(data[i]);
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
            gameData.characters.get(rootID).memories.push(memory);
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
              gameData.characters.get(rootID).income = income;
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
          case "opinions":
            gameData.characters.get(rootID).opinions.push({ id: Number(data[1]), opinon: Number(data[2]) });
            break;
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
          case "parents":
            const parent = {
              id: Number(data[1]),
              name: data[2],
              birthDateTotalDays: Number(data[3]),
              birthDate: data[4]
            };
            gameData.characters.get(rootID).parents.push(parent);
            break;
          case "parent_death":
            const parentId = Number(data[1]);
            const parentToUpdate = gameData.characters.get(rootID).parents.find((p) => p.id === parentId);
            if (parentToUpdate) {
              parentToUpdate.deathDateTotalDays = Number(data[2]);
              parentToUpdate.deathDate = data[3];
              parentToUpdate.deathReason = data[4];
            }
            break;
          case "kids":
            currentChild = {
              id: Number(data[1]),
              name: data[2],
              sheHe: data[3],
              gender: inferGenderFromPronoun(data[3]),
              birthDateTotalDays: Number(data[4]),
              birthDate: data[5],
              traits: [],
              maritalStatus: "unmarried",
              concubines: [],
              spouses: []
            };
            gameData.characters.get(rootID).children.push(currentChild);
            break;
          case "kid_other_parent":
            if (currentChild) {
              currentChild.otherParent = {
                id: Number(data[2]),
                name: data[3]
              };
            }
            break;
          case "kid_trait":
            if (currentChild && currentChild.traits) {
              currentChild.traits.push({
                category: data[2],
                name: data[3],
                desc: data[4]
              });
            }
            break;
          case "kid_is_concubine":
            if (currentChild) {
              currentChild.maritalStatus = "concubine";
              currentChild.concubineOf = {
                id: Number(data[2]),
                name: data[3]
              };
            }
            break;
          case "kid_concubine":
            if (currentChild) {
              currentChild.maritalStatus = "has_concubines";
              if (!currentChild.concubines) currentChild.concubines = [];
              currentChild.concubines.push({
                id: Number(data[2]),
                name: data[3]
              });
            }
            break;
          case "kid_spouse":
            if (currentChild) {
              currentChild.maritalStatus = "has_spouses";
              if (!currentChild.spouses) currentChild.spouses = [];
              currentChild.spouses.push({
                id: Number(data[2]),
                name: data[3]
              });
            }
            break;
          case "kid_betrothed":
            if (currentChild) {
              currentChild.maritalStatus = "betrothed";
              currentChild.betrothed = {
                id: Number(data[2]),
                name: data[3]
              };
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
            break;
          case "siblings":
            currentSibling = {
              id: Number(data[1]),
              name: data[2],
              sheHe: data[3],
              gender: inferGenderFromPronoun(data[3]),
              birthDateTotalDays: Number(data[4]),
              birthDate: data[5],
              traits: [],
              maritalStatus: "unmarried",
              concubines: [],
              spouses: []
            };
            gameData.characters.get(rootID).siblings.push(currentSibling);
            break;
          case "sibling_other_parent":
            if (currentSibling) {
              currentSibling.otherParent = {
                id: Number(data[2]),
                name: data[3]
              };
            }
            break;
          case "sibling_trait":
            if (currentSibling && currentSibling.traits) {
              currentSibling.traits.push({
                category: data[2],
                name: data[3],
                desc: data[4]
              });
            }
            break;
          case "sibling_is_concubine":
            if (currentSibling) {
              currentSibling.maritalStatus = "concubine";
              currentSibling.concubineOf = {
                id: Number(data[2]),
                name: data[3]
              };
            }
            break;
          case "sibling_concubine":
            if (currentSibling) {
              currentSibling.maritalStatus = "has_concubines";
              if (!currentSibling.concubines) currentSibling.concubines = [];
              currentSibling.concubines.push({
                id: Number(data[2]),
                name: data[3]
              });
            }
            break;
          case "sibling_spouse":
            if (currentSibling) {
              currentSibling.maritalStatus = "has_spouses";
              if (!currentSibling.spouses) currentSibling.spouses = [];
              currentSibling.spouses.push({
                id: Number(data[2]),
                name: data[3]
              });
            }
            break;
          case "sibling_betrothed":
            if (currentSibling) {
              currentSibling.maritalStatus = "betrothed";
              currentSibling.betrothed = {
                id: Number(data[2]),
                name: data[3]
              };
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
    function parseTrait(data) {
      return {
        category: data[1],
        name: data[2],
        desc: data[3]
      };
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
  
  return parseLog;
}

module.exports = { createLogParser };
