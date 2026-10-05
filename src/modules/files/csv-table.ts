/**
 * Small quote-aware parser for delimited text (CSV / TSV). Not a full
 * RFC 4180 tokenizer — it handles the layouts LLMs and spreadsheets actually
 * produce: quoted fields, "" escapes, and CRLF line endings.
 */
const MAX_SPREADSHEET_ROWS = 1000;
const MAX_SPREADSHEET_COLUMNS = 50;

export function parseDelimitedText(
  text: string,
  delimiter: string = ",",
): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }

      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === delimiter) {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n" || char === "\r") {
      row.push(field);
      field = "";

      if (row.length > 1 || row[0] !== "") {
        rows.push(row);
      }

      row = [];

      if (char === "\r" && text[index + 1] === "\n") {
        index++;
      }

      continue;
    }

    field += char;
  }

  row.push(field);

  if (row.length > 1 || row[0] !== "") {
    rows.push(row);
  }

  return rows;
}

/**
 * Parses a CSV/TSV document into a capped table suitable for rendering
 * without locking the UI on very large sheets.
 */
export function parseSpreadsheetText(
  text: string,
  fileName: string,
): string[][] {
  const delimiter = fileName.toLowerCase().endsWith(".tsv") ? "\t" : ",";

  return parseDelimitedText(text, delimiter)
    .slice(0, MAX_SPREADSHEET_ROWS)
    .map((row) => row.slice(0, MAX_SPREADSHEET_COLUMNS));
}
