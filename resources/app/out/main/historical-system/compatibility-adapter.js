"use strict";

function assertLegacyReferenceShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("legacy_reference_must_be_an_object");
  if (typeof value.period !== "string") throw new Error("legacy_reference_period_invalid");
  if (typeof value.context !== "string") throw new Error("legacy_reference_context_invalid");
  if (!Array.isArray(value.notableEvents) || value.notableEvents.some((entry) => typeof entry !== "string")) throw new Error("legacy_reference_events_invalid");
  if (!Array.isArray(value.notableFigures) || value.notableFigures.some((entry) => typeof entry !== "string")) throw new Error("legacy_reference_figures_invalid");
  return value;
}

function periodToLegacyReference(period, { eventByKey, figureByKey }) {
  if (!period) throw new Error("historical_period_required");
  const notableEvents = period.notableEventKeys.map((eventKey) => {
    const event = eventByKey.get(eventKey);
    if (!event) throw new Error(`historical_event_mapping_missing:${eventKey}`);
    return event.displayName;
  });
  const notableFigures = period.notableFigureKeys.map((figureKey) => {
    const figure = figureByKey.get(figureKey);
    if (!figure) throw new Error(`historical_figure_mapping_missing:${figureKey}`);
    return figure.identity.name;
  });
  return assertLegacyReferenceShape({
    period: period.period,
    context: period.context,
    notableEvents,
    notableFigures
  });
}

module.exports = { assertLegacyReferenceShape, periodToLegacyReference };
