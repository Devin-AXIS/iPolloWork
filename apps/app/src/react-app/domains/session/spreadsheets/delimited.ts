export type SpreadsheetRows = string[][];

export function parseDelimitedSpreadsheet(content: string, delimiter: string): SpreadsheetRows {
  const rows: SpreadsheetRows = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let start = 0;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += content.slice(start, index) + '"';
        index += 1;
        start = index + 1;
      } else if (char === '"') {
        cell += content.slice(start, index);
        start = index + 1;
        quoted = false;
      }
      continue;
    }

    if (char === '"') {
      cell += content.slice(start, index);
      start = index + 1;
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(cell + content.slice(start, index));
      start = index + 1;
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell + content.slice(start, index));
      start = index + 1;
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char === "\r") { cell += content.slice(start, index); start = index + 1; }
  }

  cell += content.slice(start);
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.length ? rows : [[""]];
}

export function serializeDelimitedSpreadsheet(rows: SpreadsheetRows, delimiter: string): string {
  return rows
    .map((row) => row.map((value) => {
      const cell = String(value ?? "");
      if (!cell.includes(delimiter) && !/["\r\n]/.test(cell)) return cell;
      return `"${cell.replace(/"/g, '""')}"`;
    }).join(delimiter))
    .join("\n") + "\n";
}
