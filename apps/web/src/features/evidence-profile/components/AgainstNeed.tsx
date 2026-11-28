'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Card, NeedVsProvenBar } from '@credalent/ui';
import { needSummary, RADAR, radarLabel, radarPoint, radarShape, type NeedRow } from '../domain/needs.ts';

// AIV-P1-044: "Against what the job needs" of the Candidate artboard (docs/01-design/artboards/Candidate.dc.html): the
// heading and intro, the radar of proven, claimed and needed levels with its legend, then "Meets the need on 4 of 6
// competencies", one need-versus-proven bar per competency and the footnote.
// Deviations, each for a rule, the data or the shared components:
// - a row is the shared NeedVsProvenBar (AIV-P0-023), which wraps (name, bar, verdict) where the artboard draws a
//   three-column grid: the shared component is used as it is, never copied (AGENTS.md 4);
// - a bar's text equivalent is "Cost and reliability: proven 1, claimed 4, job needs 2" (the ticket's Gherkin), not the
//   artboard's "Proven 1 of 5, claimed 4, the job needs 2": it names its competency, so it reads alone;
// - the rows and the radar's axes are in the order of "Competency by competency" (heaviest first, the rubric's order
//   between equal weights), so the artboard's "Product judgement" before "Cost and reliability" can come out reversed;
// - the radar's axis labels are the rubric's competency names on one or two lines of 18 characters, in ink, not the
//   artboard's hand-shortened "LLM in production" or "Arabic NLP" in muted grey: nothing stores a short name, and a
//   label must stay whole inside the chart in light and dark (AIV-P1-165 §11). A name too long for two lines ends in
//   "…"; the full names are in the rows beside it and in the radar's text equivalent;
// - the radar's text equivalent says "6 competencies", not "six target competencies", and names each competency with
//   all three of its levels, not three separate lists: one message that reads right for any number of them;
// - with fewer than three competencies there is no radar, legend or "proven shape" sentence: two axes enclose no
//   shape. The artboard draws only six;
// - the legend's "Proven by evidence" swatch is the radar's own fill and outline (12% ink, solid ink edge); the
//   artboard's swatch fades its edge with the fill, which matches nothing in the chart;
// - the footnote's "The two gaps would close if her claims hold" says "their" (a person's gender is not recorded), is
//   left out when there is no gap or no claim reaches a need, and reads "1 of the 2 gaps would close…" when only some
//   do: the artboard draws one case, and a claim that does not reach the need closes nothing (AGENTS.md 1.6);
// - the padding is the shared Card's 16 px, not 24 px, and the summary is the 16 px card heading, not 15 px:
//   @credalent/ui and the tokens have neither;
// - the verdict chips keep the shared Chip's "ok" and "warn" tones, as the artboard draws them (chip-ok, chip-warn),
//   each with its icon and words; the bars and the radar are neutral ink.

function Radar({ rows }: { rows: readonly NeedRow[] }) {
  const t = useTranslations('againstNeed');
  const n = rows.length;
  const rings = Array.from({ length: RADAR.levels }, (_, i) => i + 1);
  return (
    <svg
      viewBox={`0 0 ${RADAR.width} ${RADAR.height}`}
      role="img"
      aria-label={t('radar', { count: n, levels: rows.map((row) => t('bar', row)).join('; ') })}
      className="block h-auto w-full max-w-130"
    >
      {rings.map((level) => (
        <polygon
          key={level}
          points={radarShape(rows.map(() => level))}
          fill="none"
          strokeWidth="1"
          className="stroke-border-strong"
        />
      ))}
      {rows.map((row, i) => {
        const [x, y] = radarPoint(i, n, RADAR.r);
        return (
          <line
            key={row.competencyId}
            x1={RADAR.cx}
            y1={RADAR.cy}
            x2={x}
            y2={y}
            strokeWidth="1"
            className="stroke-border"
          />
        );
      })}
      <polygon
        points={radarShape(rows.map((row) => row.needed))}
        fill="none"
        strokeWidth="3"
        strokeLinejoin="round"
        className="stroke-text-3"
      />
      <polygon
        points={radarShape(rows.map((row) => row.claimed))}
        fill="none"
        strokeWidth="1.5"
        strokeDasharray="4 4"
        className="stroke-text-2"
      />
      <polygon
        points={radarShape(rows.map((row) => row.proven))}
        strokeWidth="2"
        strokeLinejoin="round"
        className="fill-text/12 stroke-text"
      />
      {rows.map((row, i) => {
        // 24 past the outer ring, and 5 down so the text's middle, not its baseline, sits on the axis.
        const [x, y] = radarPoint(i, n, RADAR.r + 24);
        const side = Math.round(x - RADAR.cx);
        const lines = radarLabel(row.name);
        // Two lines are centred on the axis, 16 apart; above the centre they grow upward, away from the rings.
        const first = y + 5 - (lines.length - 1) * (y < RADAR.cy ? 16 : y > RADAR.cy ? 0 : 8);
        return (
          <text
            key={row.competencyId}
            // Logical anchors would flip with the page's direction; the chart's geometry does not.
            textAnchor={side === 0 ? 'middle' : side > 0 ? 'start' : 'end'}
            direction="ltr"
            fontSize="13"
            className="fill-text"
          >
            {lines.map((line, at) => (
              <tspan key={`${at}:${line}`} x={x} y={first + at * 16}>
                {line}
              </tspan>
            ))}
          </text>
        );
      })}
    </svg>
  );
}

export function AgainstNeed({ rows }: { rows: readonly NeedRow[] }) {
  const t = useTranslations();
  const { meets, gaps, closing } = needSummary(rows);
  const charted = rows.length >= 3;
  return (
    <Card>
      <section aria-labelledby="needs" className="flex flex-wrap items-center gap-x-10 gap-y-6">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-3">
          <h2 id="needs" tabIndex={-1} className="scroll-mt-6 font-display text-section text-text">
            {t('againstNeed.title')}
          </h2>
          <p className="text-meta text-text-2">
            {t('againstNeed.intro')}
            {charted && ` ${t('againstNeed.introShape')}`}
          </p>
          {charted && (
            <>
              <Radar rows={rows} />
              <ul className="flex flex-wrap gap-x-5 gap-y-2 text-meta text-text-2">
                <li className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="h-2.5 w-4.5 rounded-xs border-2 border-text bg-text/12" />
                  {t('againstNeed.legendProven')}
                </li>
                <li className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="w-4.5 border-t-2 border-dashed border-text-2" />
                  {t('againstNeed.legendClaimed')}
                </li>
                <li className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="w-4.5 border-t-3 border-text-3" />
                  {t('againstNeed.legendNeeded')}
                </li>
              </ul>
            </>
          )}
        </div>
        <div className="flex min-w-0 flex-[1.2_1_380px] flex-col">
          <h3 className="pb-2.5 text-card text-text">{t('againstNeed.summary', { meets, count: rows.length })}</h3>
          <ul>
            {rows.map((row) => (
              <li key={row.competencyId} className="border-t border-border">
                <NeedVsProvenBar
                  name={row.name}
                  proven={row.proven}
                  claimed={row.claimed}
                  needed={row.needed}
                  levelLabel={(v) => t('score.level', v)}
                  barLabel={(v) => t('againstNeed.bar', { ...v, name: row.name })}
                  aboveLabel={t('score.aboveNeed')}
                  meetsLabel={t('score.meetsNeed')}
                  shortLabel={(short, claimed) => t(claimed ? 'score.shortClaimed' : 'score.short', { short })}
                  unavailableLabel={t('score.unavailable')}
                />
              </li>
            ))}
          </ul>
          <p className="border-t border-border pt-3 text-meta text-text-2">
            {t('againstNeed.footnote')}
            {closing > 0 &&
              ` ${t(closing === gaps ? 'againstNeed.gapsClose' : 'againstNeed.gapsCloseSome', { gaps, closing })}`}
          </p>
        </div>
      </section>
    </Card>
  );
}
