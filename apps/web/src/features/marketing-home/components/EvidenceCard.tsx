'use client';

import { EvidenceHighlight, ProvenanceTag, ScoreWithUncertainty, StrengthMeter, type Citation } from '@aivera/ui';
import { animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { caseEase, playsIntro } from '../domain/hero.ts';

export type EvidenceCardLabels = {
  name: string;
  role: string;
  /** Fixed accessible name of the score: it never counts up with the number (WCAG 4.1.2). */
  scoreName: string;
  /** Plain strings, not formatters: a Server Component renders this client one, and functions do not serialise. */
  backed: string;
  caption: string;
  upTo: string;
  unavailable: string;
  competency: string;
  weight: string;
  strength: string;
  provenance: string;
  markLabel: string;
  sources: string;
  sourceRepo: string;
  sourceCi: string;
  synthetic: string;
};

export type EvidenceCardProps = {
  backed: number;
  upTo: number;
  evidence: string;
  citations: Citation[];
  labels: EvidenceCardLabels;
};

const link = (
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
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </svg>
);

/**
 * The hero's one authored moment. Server-rendered in its final state; with motion allowed the score counts up as the
 * bar fills, the claim range wipes in, then the highlighter sweeps over the cited words (marketing.css, 120 ms steps).
 */
export function EvidenceCard({ backed, upTo, evidence, citations, labels: l }: EvidenceCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion() ?? false;
  const score = useMotionValue(backed);
  const shown = useTransform(score, Math.round);
  const [stage, setStage] = useState<'final' | 'ready' | 'play'>('final');
  const tiltX = useSpring(0, { stiffness: 160, damping: 18 });
  const tiltY = useSpring(0, { stiffness: 160, damping: 18 });

  useEffect(() => {
    const card = ref.current;
    if (!card) return;
    const box = card.getBoundingClientRect();
    const onScreen = box.top < window.innerHeight && box.bottom > 0;
    if (!playsIntro({ reducedMotion, onScreen, msSinceStart: performance.now() })) {
      score.set(backed);
      setStage('final');
      return;
    }
    score.set(0);
    setStage('ready');
    let count: ReturnType<typeof animate> | undefined;
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        seen.disconnect();
        setStage('play');
        count = animate(score, backed, { delay: 0.72, duration: 1.2, ease: caseEase });
      },
      { threshold: 0.4 },
    );
    seen.observe(card);
    return () => {
      seen.disconnect();
      count?.stop();
    };
  }, [reducedMotion, score, backed]);

  const tilt = (e: PointerEvent<HTMLDivElement>) => {
    if (reducedMotion || e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    tiltY.set(((e.clientX - r.left) / r.width - 0.5) * 5);
    tiltX.set(-((e.clientY - r.top) / r.height - 0.5) * 5);
  };
  const rest = () => {
    tiltX.set(0);
    tiltY.set(0);
  };

  return (
    <motion.div
      ref={ref}
      data-stage={stage}
      onPointerMove={tilt}
      onPointerLeave={rest}
      style={{ rotateX: tiltX, rotateY: tiltY, transformPerspective: 1200 }}
      className="mk-card relative flex flex-col gap-4 rounded-card border border-border-strong bg-surface p-6 shadow-pop"
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-card text-text">{l.name}</span>
        <span className="text-meta text-text-2 tabular-nums">{l.role}</span>
      </div>

      {/* role="img" with a fixed name: the counting number inside is presentational, so it is never announced. */}
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a drawn score, not an image file; ARIA img names it */}
      <div role="img" aria-label={l.scoreName} className="flex items-center gap-4">
        <motion.span className="min-w-[2ch] font-display text-[40px] leading-11 font-bold tracking-tight tabular-nums">
          {shown}
        </motion.span>
        <span className="mk-score min-w-0 flex-1">
          <ScoreWithUncertainty
            backed={backed}
            upTo={upTo}
            backedLabel={() => l.backed}
            captionLabel={() => l.caption}
            upToLabel={() => l.upTo}
            unavailableLabel={l.unavailable}
          />
        </span>
      </div>

      <div className="flex flex-col gap-2.5 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <span className="flex-1 basis-40 font-semibold text-text">
            {l.competency} <span className="text-meta font-normal text-text-2 tabular-nums">{l.weight}</span>
          </span>
          <StrengthMeter strength="strong" label={l.strength} />
        </div>
        <div>
          <ProvenanceTag provenance="corroborated" label={l.provenance} />
        </div>
        <p className="text-[15px] leading-6 text-text">
          <EvidenceHighlight text={evidence} citations={citations} markLabel={l.markLabel} />
        </p>
        <ul aria-label={l.sources} className="flex flex-wrap gap-x-4.5 gap-y-1.5 text-meta text-text-2">
          <li className="inline-flex items-center gap-1.5 font-mono">
            {link}
            {l.sourceRepo}
          </li>
          <li className="inline-flex items-center gap-1.5 font-mono">
            {link}
            {l.sourceCi}
          </li>
        </ul>
      </div>

      <span className="text-meta text-text-2">{l.synthetic}</span>
    </motion.div>
  );
}
