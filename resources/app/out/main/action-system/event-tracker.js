"use strict";

function getEventKey(message, event) {
  return `${message?.id ?? "unknown"}|${event?.category ?? "unknown"}|${event?.evidence?.start ?? 0}|${event?.evidence?.end ?? 0}`;
}

function getExecutionKey(event, actionId) {
  return `${event?.eventId ?? "unknown"}|${actionId ?? "unknown"}`;
}

module.exports = { getEventKey, getExecutionKey };
