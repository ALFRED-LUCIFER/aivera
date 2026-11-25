'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Card, EvidenceHighlight, ProvenanceTag, StrengthMeter } from '@credalent/ui';
import type { ReactNode } from 'react';
import type { EvidenceCard, SourceChip, SourceNoteView } from '../domain/evidenceCards.ts';
import { evidenceAnchor } from '../domain/profile.ts';

// AIV-P1-045: "Competency by competency" of the Candidate artboard (docs/01-design/artboards/Candidate.dc.html): the
// heading and intro, then one row per competency, heaviest first: name and weight, strength, provenance tag, the cited
// text highlighted, source chips and the "Limit:" line.
// Deviations, each for a rule, the data or a later ticket:
// - the body is each cited item's excerpt on its own line, highlighted whole, not a sentence with phrases highlighted
//   inside it: the evidence contract holds the exact words a score rests on (AIV-P1-024), and nothing writes a
//   sentence around them;
// - a competency the assessment cites nothing for says "No evidence is cited for this competency yet.", with no
//   strength or tag: the artboard draws no such row (AGENTS.md 1.6: a gap to close, never a reason to reject);
// - only an item behind the proven level is highlighted. The artboard highlights "cut cost per request by 40%" on a row
//   that rests on a claim; here a claim is never highlighted, whatever its strength (AGENTS.md 1.6);
// - an item whose strength or provenance differs from the row's (the strongest proven item's) carries its own
//   strength and tag beside it, which the artboard, with one item a row, does not draw: no item borrows a stronger
//   label;
// - "Awaiting live defence" (the ticket's Gherkin and the artboard) reads "To check in interview": the catalogue's one
//   label for that provenance (`evidence.provenance`), shared with the rubric and the gallery;
// - "checked 12 Nov" (Gherkin and artboard) carries the year, "checked 12 Nov 2026": the catalogue's one short date
//   format;
// - "Commit history, checked …" is text where the artboard draws a link: a check has no page of its own to open;
// - AIV-P1-043's "Cited reasons link to evidence" names the "Retrieval and evaluation" card; the phrase scrolls to the
//   first card that cites its item, since one item can back two competencies and the citation names only the item;
// - a source with no address and no uploaded file (a reference call, interview notes) is text, not a link: there is
//   nothing to open. A source backed by an uploaded file is a link for admins and recruiters only, and only where a
//   storage account is configured; a hiring owner or interviewer reads its name (AGENTS.md 1.9);
// - "Unusual content in this source" notes are listed under the rows, each with its quoted excerpt and citation: the
//   ticket's deliverable, which the artboard does not draw. Neutral ink, no highlighter, no action;
// - the section is full width, not beside a right column: "Needs live verification", "Interview history and score
//   changes" and "Across your roles" are AIV-P1-046 (#110);
// - the padding is the shared Card's 16 px, not 20 px, and a competency name is the 16 px card size, not 15 px:
//   @credalent/ui and the tokens have neither;
// - "Also submitted by another applicant" flags (AIV-P1-071) and a retry for a CV that failed to parse (AIV-P1-025),
//   both carried to this ticket in its comments, are not shown: neither is in its scenarios, each needs a contract
//   read the evidence module does not have yet, and neither has a ticket of its own yet.

const icon = (path: ReactNode) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-3.5 flex-none"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {path}
  </svg>
);
const linkIcon = icon(
  <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
);
const noteIcon = icon(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8h.01" />
  </>,
);

function Chip({ chip }: { chip: SourceChip }) {
  const t = useTranslations('candidateProfile');
  if (chip.kind === 'check') return <>{t('checked', { method: chip.method, at: chip.at })}</>;
  if (chip.kind === 'text') return <>{chip.text}</>;
  return (
    <a
      // A file opens through the route that issues its 5-minute link and audits the access; the id is opaque.
      href={chip.kind === 'link' ? chip.url : `/api/files/${chip.fileId}/link`}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:text-text"
    >
      {chip.text}
      <span className="sr-only"> {t('newTab')}</span>
    </a>
  );
}

export function EvidenceCards({ cards, notes }: { cards: EvidenceCard[]; notes: SourceNoteView[] }) {
  const t = useTranslations();
  // An item backing two competencies is drawn on both rows; only the first carries the id a cited phrase scrolls to.
  const anchored = new Map(cards.toReversed().flatMap((card) => card.items.map((i) => [i.id, card.competencyId])));
  return (
    <Card>
      <section aria-labelledby="evidence-title" className="flex flex-col">
        <div className="flex flex-col gap-0.5 pb-3.5">
          <h2 id="evidence-title" className="font-display text-section text-text">
            {t('candidateProfile.evidenceTitle')}
          </h2>
          <p className="text-meta text-text-2">{t('candidateProfile.evidenceIntro')}</p>
        </div>
        {cards.map((card) => (
          <article
            key={card.competencyId}
            aria-labelledby={`competency-${card.competencyId}`}
            className="-mx-4 flex flex-col gap-2.5 border-t border-border px-4 py-4.5 last:pb-0.5"
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <h3 id={`competency-${card.competencyId}`} className="flex-[1_1_200px] text-card text-text">
                {card.name}{' '}
                <span className="text-meta font-normal text-text-2 tabular-nums">
                  {t('candidateProfile.weight', { weight: card.weightPercent })}
                </span>
              </h3>
              {card.lead && (
                <>
                  <StrengthMeter strength={card.lead.strength} label={t(`rubric.strength.${card.lead.strength}`)} />
                  <ProvenanceTag
                    provenance={card.lead.provenance}
                    label={t(`evidence.provenance.${card.lead.provenance}`)}
                  />
                </>
              )}
            </div>
            {card.items.length === 0 ? (
              <p className="text-body text-text-2">{t('candidateProfile.noEvidence')}</p>
            ) : (
              <ul className="flex max-w-[72ch] flex-col gap-1.5 text-body text-text">
                {card.items.map((item) => (
                  <li
                    key={item.id}
                    id={anchored.get(item.id) === card.competencyId ? evidenceAnchor(item.id) : undefined}
                    className="flex scroll-mt-6 flex-wrap items-center gap-x-3 gap-y-1"
                  >
                    {/* SAFETY: the highlighter marks only what the proven level rests on; a claim stays plain (AGENTS.md 1.6). */}
                    <span>
                      {item.highlighted ? (
                        <EvidenceHighlight
                          text={item.excerpt}
                          citations={[{ start: 0, end: item.excerpt.length, sourceId: item.id }]}
                          markLabel={t('candidateProfile.markLabel')}
                        />
                      ) : (
                        item.excerpt
                      )}
                    </span>
                    {/* SAFETY: an item weaker than the row's lead says so itself; it never reads under the lead's tag. */}
                    {item.own && (
                      <>
                        <StrengthMeter strength={item.own.strength} label={t(`rubric.strength.${item.own.strength}`)} />
                        <ProvenanceTag
                          provenance={item.own.provenance}
                          label={t(`evidence.provenance.${item.own.provenance}`)}
                        />
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {card.sources.length > 0 && (
              <ul
                aria-label={t('candidateProfile.sources')}
                className="flex flex-wrap gap-x-4.5 gap-y-1.5 font-mono text-meta text-text-2"
              >
                {card.sources.map((chip) => (
                  <li key={chip.key} className="inline-flex items-center gap-1.5">
                    {linkIcon}
                    <span>
                      <Chip chip={chip} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {/* SAFETY: a row resting only on claims says it counts zero, whatever strength the claim is stored with. */}
            {[...card.limits, ...(card.claimOnly ? [t('candidateProfile.claimLimit')] : [])].map((limit) => (
              <p key={limit} className="text-meta text-text-2">
                <strong className="font-semibold text-text">{t('candidateProfile.limit')}</strong> {limit}
              </p>
            ))}
          </article>
        ))}
        {notes.length > 0 && (
          <ul className="-mx-4 flex flex-col gap-3 border-t border-border px-4 pt-4.5 pb-0.5">
            {notes.map((note) => (
              // Neutral ink with an icon and the words: a note is not a warning and changes no score (AGENTS.md 1.5).
              <li key={note.key} className="flex flex-col gap-1 text-body text-text">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  {noteIcon}
                  {t('evidence.unusualContent.title')}
                </span>
                <figure className="flex flex-col gap-1">
                  <blockquote className="max-w-[72ch] border-s-2 border-border-strong ps-3">{note.excerpt}</blockquote>
                  <figcaption className="font-mono text-meta text-text-2">
                    {note.hidden ? t('candidateProfile.noteHidden', { citation: note.citation }) : note.citation}
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
}
