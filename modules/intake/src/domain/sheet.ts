// Importing candidates from a CSV or Excel file (AIV-P1-103): the columns Credalent proposes, and what each row
// becomes. Pure: the worker reads the file and calls these. Every value here is candidate personal data: never log one.

/** The columns a recruiter maps; Name and Email are required, the rest optional. */
export const SHEET_FIELDS = ['name', 'email', 'cvLink', 'phone'] as const;
export type SheetField = (typeof SHEET_FIELDS)[number];
/** Each field's column, by its index in the header row; null when the sheet has none. */
export type SheetMapping = { name: number; email: number; cvLink: number | null; phone: number | null };

/** The most data rows one sheet may carry (below the header row). */
export const MAX_SHEET_ROWS = 1000;

/** Where a sheet import stands: the worker reads, the recruiter maps, the worker checks and fetches, the recruiter adds. */
export const SHEET_STATUSES = ['reading', 'mapping', 'fetching', 'ready', 'unreadable', 'added'] as const;
export type SheetStatus = (typeof SHEET_STATUSES)[number];
/** Why a sheet could not be read: not a readable CSV or Excel file, no header row, or over MAX_SHEET_ROWS. */
export type SheetUnreadable = 'unreadable' | 'too_many_rows';

/** Why a row adds nobody; the recruiter sees it with the row number only. */
export type RowProblem = 'missing_name' | 'missing_email' | 'invalid_email';

/**
 * One data row as the check before adding shows it. `row` is the sheet's own row number (the header is row 1), so the
 * recruiter finds it in the file. A row with a problem keeps no value; `cv` is what became of its link.
 */
export type SheetRow =
  | { row: number; problem: RowProblem }
  | {
      row: number;
      problem: null;
      name: string;
      email: string;
      phone: string | null;
      cv: 'none' | 'unreadable' | { fileId: string };
    };

const key = (header: string) =>
  header
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const NAMES: Record<SheetField, readonly string[]> = {
  name: ['name', 'fullname', 'candidatename', 'candidate', 'applicantname', 'applicant'],
  email: ['email', 'emailaddress', 'mail', 'candidateemail'],
  cvLink: ['cvlink', 'cv', 'cvurl', 'resume', 'resumeurl', 'resumelink', 'cvfile', 'resumefile'],
  phone: ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'telephone', 'tel'],
};

/**
 * The mapping Credalent proposes from the header row: the first column whose name, ignoring case, spaces, punctuation
 * and accents, is a known name of the field ("Full name", "E-mail", "Resume URL"). A required field with no match is
 * null, and the recruiter picks its column.
 */
export function proposeMapping(headers: readonly string[]): Record<SheetField, number | null> {
  const keys = headers.map(key);
  const find = (field: SheetField) => {
    const at = keys.findIndex((k) => NAMES[field].includes(k));
    return at === -1 ? null : at;
  };
  return { name: find('name'), email: find('email'), cvLink: find('cvLink'), phone: find('phone') };
}

/** A mapping the recruiter confirmed is usable: every column exists, Name and Email are set, no column used twice. */
export function isValidMapping(mapping: SheetMapping, columns: number): boolean {
  const used = Object.values(mapping).filter((c): c is number => c !== null);
  return used.every((c) => Number.isInteger(c) && c >= 0 && c < columns) && new Set(used).size === used.length;
}

/**
 * RFC 4180 CSV: quoted fields with doubled quotes, commas and line breaks inside quotes, CRLF or LF, a leading BOM.
 * A blank last line is dropped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') field += input[++i];
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) rows.push([...row, field]);
  return rows;
}

// The candidates module's own checks (modules/candidates/src/domain/person.ts), so a row it would refuse is caught
// here and explained, instead of refusing the whole batch.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+[1-9]\d{6,14}$/;

/**
 * The data rows under the mapping, with their sheet row numbers. Empty rows are skipped. `cv` is `none` here; the
 * worker sets it once it has fetched the link. A phone that is not international (E.164) is left out.
 * shortcut: a "First name" and "Last name" pair is not joined; the recruiter maps one column as Name.
 */
export function readRows(
  cells: readonly (readonly string[])[],
  mapping: SheetMapping,
): { rows: SheetRow[]; links: Map<number, string> } {
  const rows: SheetRow[] = [];
  const links = new Map<number, string>();
  cells.forEach((cellsOfRow, index) => {
    if (index === 0 || cellsOfRow.every((c) => c.trim() === '')) return;
    const row = index + 1;
    const at = (column: number | null) => (column === null ? '' : (cellsOfRow[column] ?? '').trim());
    const name = at(mapping.name).replace(/\s+/g, ' ');
    const email = at(mapping.email).toLowerCase();
    if (!name) return rows.push({ row, problem: 'missing_name' });
    if (!email) return rows.push({ row, problem: 'missing_email' });
    if (!EMAIL.test(email)) return rows.push({ row, problem: 'invalid_email' });
    const phone = at(mapping.phone)
      .replace(/[\s().-]/g, '')
      .replace(/^00/, '+');
    const link = at(mapping.cvLink);
    if (link) links.set(row, link);
    rows.push({ row, problem: null, name, email, phone: PHONE.test(phone) ? phone : null, cv: 'none' });
  });
  return { rows, links };
}
