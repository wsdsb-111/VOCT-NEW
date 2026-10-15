# Historical V9.3.3 Year/Life maintenance

These modules are excluded from every runtime build. Only the explicit, scoped `scripts/retire-year-life-v933.js` maintenance command imports them; V9.3.4 startup never invokes it. The original confirmation, backup, journal and lock checks remain. This release does not run migration or purge. Shared path/date helpers are imported from their existing source owners. Durable runtime generation, recall and recovery have no production entry here.
