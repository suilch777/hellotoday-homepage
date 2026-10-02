(function(root) {
  "use strict";
  function merge(rows) {
    const unique = new Map();
    for (const row of rows) {
      const previous = unique.get(row.uid);
      const newest = !previous || row.lastCheckInAtMs >= previous.lastCheckInAtMs ? row : previous;
      const pending = [...new Map([...(previous?.pending || []), ...row.pending].map(p => [p.id, p])).values()];
      const workers = [...new Set([...(previous?.workers || []), ...(row.workers || [])])];
      const relations = [...new Set([...(previous?.relations || []), ...(row.relation ? [row.relation] : [])])];
      const helpCount = Math.max(previous?.helpCount || 0, row.helpCount || 0);
      unique.set(row.uid, {...newest, pending, workers, relations, helpCount,
        helpRequestedAtMs: Math.max(previous?.helpRequestedAtMs || 0, row.helpRequestedAtMs || 0),
        status: helpCount ? "HELP_REQUEST" : newest.status === "COMPLETED" ? "COMPLETED" : "INCOMPLETE"});
    }
    return [...unique.values()];
  }
  function counts(rows) {
    return rows.reduce((n, row) => { n.ALL++; n[row.status]++; return n; }, {ALL: 0, COMPLETED: 0, INCOMPLETE: 0, HELP_REQUEST: 0});
  }
  function filter(rows, menu, status) {
    return rows.filter(row => menu === "checkins" ? row.pending.length > 0 : menu === "help" ? row.helpCount > 0 : status === "ALL" || row.status === status);
  }
  const api = {merge, counts, filter};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.InstitutionSeniorSummary = api;
})(typeof window !== "undefined" ? window : globalThis);
