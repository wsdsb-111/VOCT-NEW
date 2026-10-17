"use strict";
const assert = require("assert");
const { resolveCharacterAge } = require("../resources/app/out/main/worldline/character-age-service");
// Assert stable age semantics rather than exact result shape; the resolver now includes privacy-safe diagnostics.
const age = resolveCharacterAge({ alive: true, birth: "1150.9.21", age: 99, ageSource: "CK3_CURRENT_AGE" }, "1171.9.20");
assert.equal(age.age, 99);
assert.equal(age.label, "age");
assert.equal(age.source, "CK3_CURRENT_AGE");
assert.equal(age.ageSource, "CK3_CURRENT_AGE");
assert.equal(age.conflict, true);
assert.equal(age.rawAge, 99);
assert.equal(age.calculatedCalendarAge, 20);
assert.equal(age.asOfGameDate, "1171.9.20");
assert.equal(age.calendarEstimateDiffers, true);
assert.equal(age.sourceConflict, false, "an unverified calendar estimate is not authoritative source conflict");
assert.equal(age.diagnosticCode, "CALENDAR_AGE_UNVERIFIED");
console.log("V8.6.2 Current Age: PASS");
