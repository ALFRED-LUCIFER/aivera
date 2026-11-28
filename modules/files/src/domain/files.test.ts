import { getTranslations } from '@credalent/i18n';
import { describe, expect, it } from 'vitest';
import { blobName, checkUpload, contentTypeFor, parseQuarantineUrl, type Purpose } from './files.ts';

const MB = 1024 * 1024;
const t = await getTranslations('en', 'Asia/Dubai');
const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  exe: 'application/vnd.microsoft.portable-executable',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  numbers: 'application/x-iwork-numbers-sffnumbers',
};
const result = (purpose: Purpose, type: string, sizeMb: number) => {
  const refused = checkUpload({
    purpose,
    fileName: `eval-set-sample.${type}`,
    contentType: TYPES[type] ?? '',
    size: sizeMb * MB,
  });
  return refused ? t(`files.${refused}`) : 'allowed';
};

describe('Scenario Outline: Size and type limits are enforced before upload', () => {
  it.each([
    ['cv', 'pdf', 9, 'allowed'],
    ['cv', 'pdf', 11, 'PDF or Word, up to 10 MB.'],
    ['portal', 'png', 19, 'allowed'],
    ['portal', 'exe', 1, 'PDF, image or document, up to 20 MB.'],
    ['portal', 'pdf', 21, 'PDF, image or document, up to 20 MB.'],
    // AIV-P1-103 "Too large or the wrong type".
    ['candidate_sheet', 'csv', 1, 'allowed'],
    ['candidate_sheet', 'xlsx', 2, 'allowed'],
    ['candidate_sheet', 'csv', 5, 'Use a CSV or Excel file up to 2 MB.'],
    ['candidate_sheet', 'numbers', 1, 'Use a CSV or Excel file up to 2 MB.'],
  ] as const)('purpose %s, type %s, %i MB: %s', (purpose, type, size, expected) => {
    expect(result(purpose, type, size)).toBe(expected);
  });
});

describe('checkUpload: the declared type, the extension and the size must all agree', () => {
  const pdf = { purpose: 'evidence', fileName: 'notes.pdf', contentType: 'application/pdf', size: MB } as const;
  it.each([
    ['a PDF', pdf, null],
    ['exactly the limit', { ...pdf, size: 20 * MB }, null],
    ['one byte over', { ...pdf, size: 20 * MB + 1 }, 'limits.evidence'],
    ['an empty file', { ...pdf, size: 0 }, 'limits.evidence'],
    ['a PNG declared as a PDF', { ...pdf, fileName: 'notes.png' }, 'limits.evidence'],
    ['a PDF with no extension', { ...pdf, fileName: 'notes' }, 'limits.evidence'],
    ['an upper-case extension', { ...pdf, fileName: 'NOTES.PDF' }, null],
    ['a PNG as a CV', { ...pdf, purpose: 'cv', fileName: 'cv.png', contentType: 'image/png' }, 'limits.cv'],
    ['a prototype key as the extension', { ...pdf, fileName: 'x.constructor' }, 'limits.evidence'],
  ] as const)('%s', (_label, request, refused) => {
    expect(checkUpload(request)).toBe(refused);
  });

  it('derives the content type from the extension, for browsers that leave a file type empty', () => {
    expect(contentTypeFor('cv.DOCX')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(contentTypeFor('setup.exe')).toBeNull();
  });
});

describe('blob names carry opaque ids only and parse back from a scan result URL', () => {
  const W = '0190d4a2-0000-7000-8000-0000000000a1';
  const F = '0190d4a2-0000-7000-8000-0000000000f1';
  it('round-trips a workspace and a candidate account owner', () => {
    for (const owner of [{ workspaceId: W }, { candidateAccountId: W }]) {
      const url = `https://st.blob.core.windows.net/uploads-quarantine/${blobName(owner, F)}`;
      expect(parseQuarantineUrl(url)).toEqual({ owner, fileId: F });
    }
  });

  it('refuses a blob outside quarantine or with anything but ids', () => {
    expect(parseQuarantineUrl(`https://st.blob.core.windows.net/evidence/w/${W}/${F}`)).toBeNull();
    expect(parseQuarantineUrl(`https://st.blob.core.windows.net/uploads-quarantine/w/${W}/cv.pdf`)).toBeNull();
  });
});
