// Documents and write-ups as evidence (AIV-P1-028): a requirements document or an outcome write-up counts as real work,
// supplied by the candidate. Its authorship is unverified until a second source confirms it (AIV-P1-029), so every
// item is "Candidate-submitted" and at most Medium ("real work, but authorship or scale is unclear").
import type { UnusualContent } from '@credalent/ai';
import type { CvLayout } from './cv.ts';
import type { EvidenceItem } from './evidence.ts';

export const DOCUMENT_READ_STATUSES = ['pending', 'read', 'unreadable', 'failed'] as const;
export type DocumentReadStatus = (typeof DOCUMENT_READ_STATUSES)[number];

/** The files module's purposes a document may come from: an evidence upload or the portal (AIV-P1-041). */
export const DOCUMENT_PURPOSES: readonly string[] = ['evidence', 'portal'];

const OOXML = 'PK\x03\x04';
/** How each content type the files module takes for evidence starts. */
const MAGIC: Record<string, string> = {
  'application/pdf': '%PDF-',
  'image/png': '\x89PNG',
  'image/jpeg': '\xff\xd8\xff',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': OOXML,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': OOXML,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': OOXML,
};

/** True when the bytes start the way the stated content type does (an .exe sent as application/pdf is not). */
export function isDocument(contentType: string, data: Uint8Array): boolean {
  const magic = MAGIC[contentType];
  return magic !== undefined && String.fromCharCode(...data.subarray(0, magic.length)) === magic;
}

/** The item's limit, which the evidence profile shows: "Decision document supplied, authorship unverified." */
export const documentLimit = (label: string) => `${label} supplied, authorship unverified.`;

export type DocumentItem = Pick<EvidenceItem, 'excerpt' | 'excerptSpan' | 'provenance' | 'strength' | 'limit'>;

/**
 * One item per page with text, cited "page N", in page order. Text a note flags (aimed at an AI, or hidden in the file)
 * is cut out of the excerpt, so mapping reads the document as if that text were not there; the note keeps it for a
 * person to see.
 */
export function documentItems(layout: CvLayout, label: string, notes: readonly UnusualContent[]): DocumentItem[] {
  // Masked with NUL first so every offset still holds, then dropped.
  let masked = layout.content;
  for (const n of notes) masked = masked.slice(0, n.start) + '\0'.repeat(n.end - n.start) + masked.slice(n.end);
  return layout.pages.flatMap((page) => {
    const text = page.spans.map((s) => masked.slice(s.offset, s.offset + s.length)).join('');
    const excerpt = text.replaceAll('\0', '').trim();
    if (!excerpt) return [];
    return [
      {
        excerpt,
        excerptSpan: `page ${page.pageNumber}`,
        provenance: 'submitted',
        strength: 'medium',
        limit: documentLimit(label),
      },
    ];
  });
}
