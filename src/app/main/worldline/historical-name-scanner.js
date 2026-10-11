"use strict";

const MAX_SCAN_CHARACTERS = 3000;
const MAX_NAME_MATCHES = 32;
const normalizeName = value => String(value || "").trim().normalize("NFKC").toLocaleLowerCase();

class HistoricalNameScanner {
  constructor(names = []) {
    this.root = new Map();
    for (const name of names) {
      const key = normalizeName(name);
      if (key.length < 2 || key.length > MAX_SCAN_CHARACTERS || /^[#\d]+$/.test(key)) continue;
      let node = this.root;
      for (let i = 0; i < key.length; i++) {
        if (!node.has(key[i])) node.set(key[i], new Map());
        node = node.get(key[i]);
      }
      node.value = key;
    }
  }
  scan(value) {
    const normalizedQuery = normalizeName(value);
    const query = normalizedQuery.slice(0, MAX_SCAN_CHARACTERS);
    const matches = [];
    for (let start = 0; start < query.length; start++) {
      let node = this.root, longest = null;
      for (let end = start; end < query.length; end++) {
        node = node.get(query[end]);
        if (!node) break;
        if (node.value) longest = { value: node.value, start, end: end + 1 };
      }
      if (longest) matches.push(longest);
    }
    const selected = [];
    const occupied = new Uint8Array(query.length);
    for (const match of matches.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)) {
      if (occupied.subarray(match.start, match.end).some(Boolean)) continue;
      occupied.fill(1, match.start, match.end);
      selected.push(match);
    }
    selected.sort((a, b) => a.start - b.start);
    return { normalizedQuery: query, matches: selected.slice(0, MAX_NAME_MATCHES), candidateSetComplete: normalizedQuery.length <= MAX_SCAN_CHARACTERS && selected.length <= MAX_NAME_MATCHES };
  }
}

module.exports = { HistoricalNameScanner, normalizeName, MAX_SCAN_CHARACTERS, MAX_NAME_MATCHES };
