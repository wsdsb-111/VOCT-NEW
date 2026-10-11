function dateOrder(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,6})[.\-/](\d{1,2})[.\-/](\d{1,2})$/) || text.match(/^(\d{1,6})年(\d{1,2})月(\d{1,2})日$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthLengths[month - 1]) return null;
  return year * 10000 + month * 100 + day;
}

export function getSummaryDisplayEntries(summaries, sortByDate = true) {
  // Keep file indices intact for edit, delete and regenerate IPC calls.
  const entries = summaries.map((summary, index) => ({ summary, index }));
  if (!sortByDate) return entries;
  return entries.sort((left, right) => {
    const leftDate = dateOrder(left.summary.date);
    const rightDate = dateOrder(right.summary.date);
    if (leftDate === rightDate) return left.index - right.index;
    if (leftDate === null) return 1;
    if (rightDate === null) return -1;
    return rightDate - leftDate;
  });
}
