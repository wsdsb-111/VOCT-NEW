"use strict";

const HISTORICAL_SCHEMA_VERSION = 1;
const VALID_SENSITIVITY = new Set(["low", "medium", "high"]);
const VALID_IMPORTANCE = new Set(["unknown", "low", "medium", "high"]);
const VALID_FIGURE_GENDERS = new Set(["male", "female", "unknown", null]);
const VALID_FAMILY_RELATIONS = new Set(["parent", "child", "sibling", "spouse"]);
const VALID_CONFIDENCE_POLICIES = new Set(["standard", "conservative"]);
const FIGURE_HINT_KEYS = Object.freeze(["cultures", "houses", "titles", "positions", "realms", "locations"]);

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}_must_be_an_object`);
  return value;
}

function assertString(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return value;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}_must_be_a_non_empty_string`);
  return value;
}

function assertInteger(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return value;
  if (!Number.isInteger(value)) throw new Error(`${label}_must_be_an_integer`);
  return value;
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) throw new Error(`${label}_must_be_a_string_array`);
  return value;
}

function validateDate(date, label = "historical_date", { allowUnknown = true } = {}) {
  assertObject(date, label);
  const year = assertInteger(date.year, `${label}_year`, { nullable: allowUnknown });
  const month = assertInteger(date.month, `${label}_month`, { nullable: true });
  const day = assertInteger(date.day, `${label}_day`, { nullable: true });
  if (year !== null && year < 1) throw new Error(`${label}_year_out_of_range`);
  if (year === null && (month !== null || day !== null)) throw new Error(`${label}_partial_without_year`);
  if (month === null && day !== null) throw new Error(`${label}_day_without_month`);
  if (month !== null && (month < 1 || month > 12)) throw new Error(`${label}_month_out_of_range`);
  if (day !== null) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    if (day < 1 || day > daysInMonth) throw new Error(`${label}_day_out_of_range`);
  }
  return date;
}

function validateHistoricalPeriod(period) {
  assertObject(period, "historical_period");
  assertString(period.key, "historical_period_key");
  const startYear = assertInteger(period.startYear, "historical_period_start_year", { nullable: true });
  const endYearExclusive = assertInteger(period.endYearExclusive, "historical_period_end_year_exclusive", { nullable: true });
  if (startYear !== null && endYearExclusive !== null && startYear >= endYearExclusive) throw new Error(`historical_period_invalid_range:${period.key}`);
  assertString(period.baselineDynasty, `historical_period_baseline_dynasty:${period.key}`);
  assertString(period.period, `historical_period_name:${period.key}`);
  assertString(period.context, `historical_period_context:${period.key}`);
  assertStringArray(period.notableEventKeys, `historical_period_event_keys:${period.key}`);
  assertStringArray(period.notableFigureKeys, `historical_period_figure_keys:${period.key}`);
  assertString(period.expectedRulerKey, `historical_period_expected_ruler_key:${period.key}`, { nullable: true });
  return period;
}

function validateHistoricalFigure(figure) {
  assertObject(figure, "historical_figure");
  assertString(figure.figureKey, "historical_figure_key");
  assertObject(figure.identity, `historical_figure_identity:${figure.figureKey}`);
  assertString(figure.identity.name, `historical_figure_name:${figure.figureKey}`);
  assertStringArray(figure.identity.aliases, `historical_figure_aliases:${figure.figureKey}`);
  assertObject(figure.life, `historical_figure_life:${figure.figureKey}`);
  const birthYear = assertInteger(figure.life.birthYear, `historical_figure_birth_year:${figure.figureKey}`, { nullable: true });
  const deathYear = assertInteger(figure.life.deathYear, `historical_figure_death_year:${figure.figureKey}`, { nullable: true });
  if (birthYear !== null && deathYear !== null && birthYear > deathYear) throw new Error(`historical_figure_invalid_life:${figure.figureKey}`);
  assertObject(figure.activeWindow, `historical_figure_active_window:${figure.figureKey}`);
  const earliestYear = assertInteger(figure.activeWindow.earliestYear, `historical_figure_active_from:${figure.figureKey}`, { nullable: true });
  const latestYear = assertInteger(figure.activeWindow.latestYear, `historical_figure_active_to:${figure.figureKey}`, { nullable: true });
  if (earliestYear !== null && latestYear !== null && earliestYear > latestYear) throw new Error(`historical_figure_invalid_active_window:${figure.figureKey}`);
  assertString(figure.baselineDynasty, `historical_figure_baseline_dynasty:${figure.figureKey}`, { nullable: true });
  if (!VALID_IMPORTANCE.has(figure.historicalImportance)) throw new Error(`historical_figure_invalid_importance:${figure.figureKey}`);
  assertString(figure.seedingType, `historical_figure_seeding_type:${figure.figureKey}`);
  assertStringArray(figure.historicalFactIds, `historical_figure_fact_ids:${figure.figureKey}`);
  return figure;
}

function validateFigureMatchingRecord(record) {
  assertObject(record, "figure_matching");
  assertString(record.figureKey, "figure_matching_key");
  if (typeof record.resolverReady !== "boolean") throw new Error(`figure_matching_resolver_ready_must_be_a_boolean:${record.figureKey}`);
  assertObject(record.intrinsic, `figure_matching_intrinsic:${record.figureKey}`);
  if (!VALID_FIGURE_GENDERS.has(record.intrinsic.gender)) throw new Error(`figure_matching_gender_invalid:${record.figureKey}`);
  const birthYear = assertInteger(record.intrinsic.birthYear, `figure_matching_birth_year:${record.figureKey}`, { nullable: true });
  if (birthYear !== null && birthYear < 1) throw new Error(`figure_matching_birth_year_out_of_range:${record.figureKey}`);
  assertObject(record.hints, `figure_matching_hints:${record.figureKey}`);
  for (const key of FIGURE_HINT_KEYS) assertStringArray(record.hints[key], `figure_matching_${key}:${record.figureKey}`);
  if (!Array.isArray(record.familyHints)) throw new Error(`figure_matching_family_hints_must_be_an_array:${record.figureKey}`);
  for (const hint of record.familyHints) {
    assertObject(hint, `figure_matching_family_hint:${record.figureKey}`);
    if (!VALID_FAMILY_RELATIONS.has(hint.relation)) throw new Error(`figure_matching_family_relation_invalid:${record.figureKey}`);
    assertStringArray(hint.names, `figure_matching_family_names:${record.figureKey}`);
    if (hint.names.length === 0) throw new Error(`figure_matching_family_names_empty:${record.figureKey}`);
  }
  if (!VALID_CONFIDENCE_POLICIES.has(record.confidencePolicy)) throw new Error(`figure_matching_confidence_policy_invalid:${record.figureKey}`);
  if (typeof record.reviewed !== "boolean") throw new Error(`figure_matching_reviewed_must_be_a_boolean:${record.figureKey}`);
  assertStringArray(record.sources, `figure_matching_sources:${record.figureKey}`);
  return record;
}

function validateFigureMatchingDataset(records, figures) {
  if (!Array.isArray(records)) throw new Error("figure_matching_dataset_must_be_an_array");
  if (!Array.isArray(figures)) throw new Error("figure_matching_figures_must_be_an_array");
  const figureByKey = indexUnique(figures, "figureKey", "figure_matching_figure");
  const matchingByKey = new Map();
  for (const record of records) {
    validateFigureMatchingRecord(record);
    if (!figureByKey.has(record.figureKey)) throw new Error(`figure_matching_unknown_figure:${record.figureKey}`);
    if (matchingByKey.has(record.figureKey)) throw new Error(`figure_matching_duplicate:${record.figureKey}`);
    const figure = figureByKey.get(record.figureKey);
    if (record.resolverReady) {
      if (!record.reviewed || record.sources.length === 0) throw new Error(`figure_matching_ready_without_review:${record.figureKey}`);
      if (record.intrinsic.birthYear === null && !Number.isInteger(figure.activeWindow?.earliestYear)) throw new Error(`figure_matching_ready_without_temporal_anchor:${record.figureKey}`);
      const auxiliaryHints = FIGURE_HINT_KEYS.reduce((count, key) => count + record.hints[key].length, 0) + record.familyHints.length;
      if (auxiliaryHints === 0) throw new Error(`figure_matching_ready_without_auxiliary_hint:${record.figureKey}`);
    }
    matchingByKey.set(record.figureKey, record);
  }
  for (const figure of figures) if (!matchingByKey.has(figure.figureKey)) throw new Error(`figure_matching_missing_figure:${figure.figureKey}`);
  return matchingByKey;
}

function validateHistoricalFact(fact) {
  assertObject(fact, "historical_fact");
  assertString(fact.factId, "historical_fact_id");
  assertString(fact.figureKey, `historical_fact_figure_key:${fact.factId}`, { nullable: true });
  assertString(fact.type, `historical_fact_type:${fact.factId}`);
  if (fact.value === undefined) throw new Error(`historical_fact_value_required:${fact.factId}`);
  const validFrom = assertInteger(fact.validFrom, `historical_fact_valid_from:${fact.factId}`, { nullable: true });
  const validTo = assertInteger(fact.validTo, `historical_fact_valid_to:${fact.factId}`, { nullable: true });
  if (validFrom !== null && validTo !== null && validFrom > validTo) throw new Error(`historical_fact_invalid_range:${fact.factId}`);
  if (!VALID_SENSITIVITY.has(fact.sensitivity)) throw new Error(`historical_fact_invalid_sensitivity:${fact.factId}`);
  assertStringArray(fact.dependencies, `historical_fact_dependencies:${fact.factId}`);
  return fact;
}

function validateHistoricalEvent(event) {
  assertObject(event, "historical_event");
  assertString(event.eventKey, "historical_event_key");
  assertString(event.displayName, `historical_event_display_name:${event.eventKey}`);
  validateDate(event.date, `historical_event_date:${event.eventKey}`);
  assertString(event.baselineDynasty, `historical_event_baseline_dynasty:${event.eventKey}`, { nullable: true });
  if (!VALID_SENSITIVITY.has(event.sensitivity)) throw new Error(`historical_event_invalid_sensitivity:${event.eventKey}`);
  return event;
}

function validateRuler(ruler) {
  assertObject(ruler, "historical_ruler");
  assertString(ruler.rulerKey, "historical_ruler_key");
  assertString(ruler.name, `historical_ruler_name:${ruler.rulerKey}`);
  assertStringArray(ruler.aliases, `historical_ruler_aliases:${ruler.rulerKey}`);
  assertObject(ruler.reign, `historical_ruler_reign:${ruler.rulerKey}`);
  const fromYear = assertInteger(ruler.reign.fromYear, `historical_ruler_from_year:${ruler.rulerKey}`, { nullable: true });
  const toYear = assertInteger(ruler.reign.toYear, `historical_ruler_to_year:${ruler.rulerKey}`, { nullable: true });
  if (fromYear !== null && toYear !== null && fromYear > toYear) throw new Error(`historical_ruler_invalid_reign:${ruler.rulerKey}`);
  assertString(ruler.polity, `historical_ruler_polity:${ruler.rulerKey}`);
  return ruler;
}

function indexUnique(items, key, label) {
  if (!Array.isArray(items)) throw new Error(`${label}_must_be_an_array`);
  const indexed = new Map();
  for (const item of items) {
    const id = item[key];
    if (indexed.has(id)) throw new Error(`${label}_duplicate:${id}`);
    indexed.set(id, item);
  }
  return indexed;
}

function validateHistoricalDataset(dataset) {
  assertObject(dataset, "historical_dataset");
  const periods = dataset.periods.map(validateHistoricalPeriod);
  const figures = dataset.figures.map(validateHistoricalFigure);
  const facts = dataset.facts.map(validateHistoricalFact);
  const events = dataset.events.map(validateHistoricalEvent);
  const rulers = dataset.rulers.map(validateRuler);
  const periodByKey = indexUnique(periods, "key", "historical_period");
  const figureByKey = indexUnique(figures, "figureKey", "historical_figure");
  const factById = indexUnique(facts, "factId", "historical_fact");
  const eventByKey = indexUnique(events, "eventKey", "historical_event");
  const rulerByKey = indexUnique(rulers, "rulerKey", "historical_ruler");
  const orderedPeriods = [...periods].sort((left, right) => (left.startYear ?? Number.NEGATIVE_INFINITY) - (right.startYear ?? Number.NEGATIVE_INFINITY));
  if (orderedPeriods.length === 0) throw new Error("historical_period_empty");
  if (orderedPeriods[0].startYear !== null) throw new Error(`historical_period_start_not_unbounded:${orderedPeriods[0].key}`);
  if (orderedPeriods[orderedPeriods.length - 1].endYearExclusive !== null) throw new Error(`historical_period_end_not_unbounded:${orderedPeriods[orderedPeriods.length - 1].key}`);
  for (let index = 1; index < orderedPeriods.length; index += 1) {
    const previous = orderedPeriods[index - 1];
    const current = orderedPeriods[index];
    if (previous.endYearExclusive === null || current.startYear === null || previous.endYearExclusive > current.startYear) throw new Error(`historical_period_overlap:${previous.key}:${current.key}`);
    if (previous.endYearExclusive < current.startYear) throw new Error(`historical_period_gap:${previous.key}:${current.key}`);
  }
  for (const period of periods) {
    for (const eventKey of period.notableEventKeys) if (!eventByKey.has(eventKey)) throw new Error(`historical_period_unknown_event:${period.key}:${eventKey}`);
    for (const figureKey of period.notableFigureKeys) if (!figureByKey.has(figureKey)) throw new Error(`historical_period_unknown_figure:${period.key}:${figureKey}`);
    if (period.expectedRulerKey !== null && !rulerByKey.has(period.expectedRulerKey)) throw new Error(`historical_period_unknown_ruler:${period.key}:${period.expectedRulerKey}`);
  }
  for (const figure of figures) {
    for (const factId of figure.historicalFactIds) {
      const fact = factById.get(factId);
      if (!fact) throw new Error(`historical_figure_unknown_fact:${figure.figureKey}:${factId}`);
      if (fact.figureKey !== figure.figureKey) throw new Error(`historical_figure_fact_owner_mismatch:${figure.figureKey}:${factId}`);
    }
  }
  for (const fact of facts) {
    if (fact.figureKey === null) continue;
    const figure = figureByKey.get(fact.figureKey);
    if (!figure) throw new Error(`historical_fact_unknown_figure:${fact.factId}:${fact.figureKey}`);
    if (!figure.historicalFactIds.includes(fact.factId)) throw new Error(`historical_fact_missing_from_figure:${fact.factId}:${fact.figureKey}`);
  }
  return { periodByKey, figureByKey, factById, eventByKey, rulerByKey };
}

module.exports = {
  HISTORICAL_SCHEMA_VERSION,
  VALID_SENSITIVITY,
  VALID_FIGURE_GENDERS,
  VALID_FAMILY_RELATIONS,
  FIGURE_HINT_KEYS,
  validateDate,
  validateHistoricalPeriod,
  validateHistoricalFigure,
  validateFigureMatchingRecord,
  validateFigureMatchingDataset,
  validateHistoricalFact,
  validateHistoricalEvent,
  validateRuler,
  validateHistoricalDataset
};
