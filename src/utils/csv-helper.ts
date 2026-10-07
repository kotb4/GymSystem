/**
 * CSV Parser & Generator utilities with full Arabic UTF-8 (BOM) support.
 * Works seamlessly with Microsoft Excel on Windows.
 */

/**
 * Normalizes dates from various formats (e.g. DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, D/M/YYYY)
 * into standard ISO date key (YYYY-MM-DD).
 */
export function normalizeDateInput(val: string | null | undefined): string | null {
  if (!val || typeof val !== "string") return null;
  const s = val.trim();
  if (!s) return null;

  // Case 1: Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }

  // Case 2: DD/MM/YYYY or DD-MM-YYYY or D/M/YYYY or D-M-YYYY
  const dmyMatch = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, "0");
    const month = dmyMatch[2].padStart(2, "0");
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Case 3: YYYY/MM/DD
  const ymdSlash = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (ymdSlash) {
    const year = ymdSlash[1];
    const month = ymdSlash[2].padStart(2, "0");
    const day = ymdSlash[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return s;
}

/**
 * Parses raw CSV string into rows of string arrays.
 * Correctly handles quotes, commas, semicolons, and CRLF newlines.
 */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "").trim();
  if (!clean) return [];

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  // Detect delimiter (comma vs semicolon, common in localized Excel)
  const firstLine = clean.split(/\r?\n/)[0] || "";
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const delimiter = semiCount > commaCount ? ";" : ",";

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const nextChar = clean[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentCell += '"';
        i++; // skip escaped quote
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        currentRow.push(currentCell.trim());
        currentCell = "";
      } else if (char === "\r") {
        // Skip CR if followed by LF
        if (nextChar === "\n") {
          i++;
        }
        currentRow.push(currentCell.trim());
        currentCell = "";
        if (currentRow.some((c) => c !== "")) {
          rows.push(currentRow);
        }
        currentRow = [];
      } else if (char === "\n") {
        currentRow.push(currentCell.trim());
        currentCell = "";
        if (currentRow.some((c) => c !== "")) {
          rows.push(currentRow);
        }
        currentRow = [];
      } else {
        currentCell += char;
      }
    }
  }

  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c !== "")) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Generates and triggers download of a CSV file with UTF-8 BOM so Excel opens it with Arabic text correctly.
 */
export function downloadCsvWithBom(filename: string, headers: string[], rows: (string | number | null | undefined)[][]): void {
  const escapeCell = (val: string | number | null | undefined): string => {
    if (val == null) return "";
    const str = String(val);
    if (str.includes(",") || str.includes(";") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerLine = headers.map(escapeCell).join(",");
  const dataLines = rows.map((row) => row.map(escapeCell).join(",")).join("\r\n");
  const csvContent = `${headerLine}\r\n${dataLines}`;

  // Prepend UTF-8 BOM (\uFEFF)
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
