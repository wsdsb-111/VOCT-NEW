"use strict";

(function exposeHistoricalDashboardHelpers(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.VOTCHistoricalDashboard = api;
})(typeof window !== "undefined" ? window : globalThis, function createHistoricalDashboardHelpers() {
  const REVIEW_PRIORITY = ["AMBIGUOUS", "CANDIDATE", "DUE_UNRESOLVED"];
  const STATUS_FILTERS = {
    ALL: null,
    RESOLVED: new Set(["RESOLVED"]),
    REVIEW: new Set(REVIEW_PRIORITY),
    AMBIGUOUS: new Set(["AMBIGUOUS"]),
    UNRESOLVED: new Set(["DUE_UNRESOLVED"]),
    NOT_DUE: new Set(["NOT_DUE"])
  };
  const searchText = (row) => [
    row.figureKey,
    row.historical?.name,
    ...(row.historical?.aliases || []),
    row.character?.id,
    row.character?.name,
    row.character?.fullName,
    ...(row.alternatives || []).flatMap((item) => [item.characterId, item.displayName, item.character?.name, item.character?.fullName])
  ].filter((value) => value !== null && value !== undefined).join(" ").toLocaleLowerCase("zh-CN");
  const filterFigureRows = (rows, { readyOnly = true, statusFilter = "ALL", search = "" } = {}) => {
    const statuses = STATUS_FILTERS[statusFilter] || null;
    const query = String(search || "").trim().toLocaleLowerCase("zh-CN");
    return (rows || []).filter((row) => {
      if (readyOnly && row.historical?.resolverReady !== true) return false;
      if (statuses && !statuses.has(row.resolution?.status)) return false;
      return !query || searchText(row).includes(query);
    });
  };
  const findNextReviewFigureKey = (rows, currentFigureKey = null) => {
    const ordered = REVIEW_PRIORITY.flatMap((status) => (rows || []).filter((row) => row.historical?.resolverReady === true && row.resolution?.status === status));
    if (ordered.length === 0) return null;
    const currentIndex = ordered.findIndex((row) => row.figureKey === currentFigureKey);
    return ordered[currentIndex >= 0 ? (currentIndex + 1) % ordered.length : 0].figureKey;
  };
  const groupEvidence = (items) => {
    const groups = { identity: [], auxiliary: [], worldState: [], historical: [], other: [] };
    for (const item of items || []) {
      const code = item?.code || "";
      if (/^(NAME|AGE|BIRTH|GENDER|FAMILY)/.test(code)) groups.identity.push(item);
      else if (/^(CULTURE|HOUSE)/.test(code)) groups.auxiliary.push(item);
      else if (/^(TITLE|POSITION|REALM|LOCATION)/.test(code)) groups.worldState.push(item);
      else if (/^(SURVIVED|HISTORICAL)/.test(code)) groups.historical.push(item);
      else groups.other.push(item);
    }
    return groups;
  };
  const displayValue = (value) => value === null || value === undefined || value === "" ? "—" : String(value);
  return { REVIEW_PRIORITY, STATUS_FILTERS, filterFigureRows, findNextReviewFigureKey, groupEvidence, displayValue };
});
