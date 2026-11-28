// Reads an imported CSV or Excel file into text cells (AIV-P1-103), on the worker only. The Excel reader takes the
// first sheet's stored values: formulas are never evaluated and nothing is fetched. Errors are not passed on, since a
// parser's message can quote a cell: an unreadable file is just `unreadable`.
import { readSheet } from 'read-excel-file/node';
import { parseCsv } from '../domain/sheet.ts';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** UTF-8, or Windows-1252 for a CSV saved by Excel's plain "CSV" option, which is not UTF-8. */
function decode(data: Buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return new TextDecoder('windows-1252').decode(data);
  }
}

const text = (cell: unknown) =>
  cell === null || cell === undefined ? '' : cell instanceof Date ? cell.toISOString().slice(0, 10) : String(cell);

// shortcut: a zip bomb inside a 2 MB .xlsx is bounded only by the worker's memory; check the entries' sizes before
// reading if a hostile file is ever seen.
export async function readSheetCells(data: Buffer, contentType: string): Promise<string[][] | 'unreadable'> {
  try {
    if (contentType === 'text/csv') return parseCsv(decode(data));
    if (contentType === XLSX) return (await readSheet(data)).map((row) => row.map(text));
  } catch {
    // Not a zip, or a broken workbook.
  }
  return 'unreadable';
}
