"use strict";

function display(localize, type, raw) {
  if (!raw) return null;
  const resolved = localize?.(type, String(raw));
  return resolved?.localizedValue || resolved?.displayName || String(raw);
}

function buildWarCandidates(snapshot, diagnostics = []) {
  const titlesByHolder = new Map();
  for (const [id, title] of Object.entries(snapshot?.titles || {})) {
    if (!title.holder) continue;
    const holder = String(title.holder);
    if (!titlesByHolder.has(holder)) titlesByHolder.set(holder, []);
    titlesByHolder.get(holder).push({ id, name: title.displayName || title.key || `#${id}`, key: title.key, localizationKey: title.localizationKey });
  }
  const participant = (id) => {
    const character = snapshot?.characters?.[String(id)];
    if (!character) return null;
    const titles = titlesByHolder.get(String(id)) || [];
    const name = character.fullName || character.firstName || `#${id}`;
    const rank = title => ({ h: 6, e: 5, k: 4, d: 3, c: 2, b: 1 })[title.key?.[0]] || 0;
    titles.sort((left, right) => rank(right) - rank(left));
    return { id: String(id), name, titles, label: `${name}${titles.length ? `（${titles[0].name}）` : ""}` };
  };
  return Object.entries(snapshot?.wars || {}).flatMap(([id, war]) => {
    if (war.endDate) return [];
    const attackers = (war.attacker || []).map(participant).filter(Boolean);
    const defenders = (war.defender || []).map(participant).filter(Boolean);
    // Both sides must be tied to real runtime characters; numeric metadata is not a participant.
    if (!attackers.length || !defenders.length) {
      diagnostics.push({ type: "GAME_TRUTH", id: `war:${id}`, reason: "WAR_SKIPPED_NO_RUNTIME_ACTOR" });
      return [];
    }
    const actors = [...attackers, ...defenders];
    const title = `${sideLabel(attackers)}与${sideLabel(defenders)}`;
    return [{
      id: `war:${id}`, category: "GAME_TRUTH", kind: "WAR", sourceTier: "GAME_TRUTH",
      eventType: "WAR_ACTIVE", gameDate: snapshot.gameDate, importance: "HIGH", title,
      entityRefs: { characters: actors.map(actor => actor.id), titles: actors.flatMap(actor => actor.titles.map(title => title.id)), keys: actors.flatMap(actor => [actor.name, ...actor.titles.flatMap(title => [title.key, title.name])]).filter(Boolean) },
      payload: { id, war, attackers, defenders }
    }];
  });
}

function sideLabel(actors) {
  return actors.slice(0, 2).map(actor => actor.label.slice(0, 60)).join("、") + (actors.length > 2 ? `等${actors.length}位参战者` : "");
}

function localizeWarCandidate(candidate, localize, queryPlan = null) {
  const characterIds = new Set(queryPlan?.entities?.characters || []);
  const titleIds = new Set(queryPlan?.entities?.titles || []);
  const relevant = actor => characterIds.has(actor.id) || actor.titles.some(title => titleIds.has(title.id)) ? 1 : 0;
  const ordered = actors => [...actors].sort((left, right) => relevant(right) - relevant(left));
  const localizeActor = actor => {
    const name = display(localize, "character", actor.name);
    const title = actor.titles[0];
    const titleName = title ? display(localize, "title", title.name) : null;
    return { ...actor, label: `${name}${titleName ? `（${titleName}）` : ""}` };
  };
  const attackers = ordered(candidate.payload.attackers).map((actor, index) => index < 2 ? localizeActor(actor) : actor);
  const defenders = ordered(candidate.payload.defenders).map((actor, index) => index < 2 ? localizeActor(actor) : actor);
  return { ...candidate, title: `${sideLabel(attackers)}与${sideLabel(defenders)}`, payload: { ...candidate.payload, attackers, defenders } };
}

function warLine(candidate) {
  const { attackers, defenders, war } = candidate.payload;
  return `截至 ${candidate.gameDate}，正在交战。进攻方：${sideLabel(attackers)}；防守方：${sideLabel(defenders)}${war.startDate ? `；开战日期：${war.startDate}` : ""}。这是存档中的活跃战争，未提供胜负或结束结论。`;
}

module.exports = { buildWarCandidates, localizeWarCandidate, warLine };
