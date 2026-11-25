import type { ReactNode } from 'react';
import { cx } from './cx.ts';

/** `interviewer`: an interviewer's account of the interview (AIV-P1-115), neither the candidate's nor checked work. */
export type Provenance = 'corroborated' | 'submitted' | 'interviewer' | 'claim' | 'contradictory' | 'awaiting-defence';

// Foundations artboard .chip-*: each provenance has its own icon shape, so the meaning survives without colour.
const looks: Record<Provenance, { chip: string; icon: ReactNode }> = {
  corroborated: {
    chip: 'border-ok-border bg-ok-bg text-ok-text',
    icon: <path d="m2 12.5 4.5 4.5L15 8M11.5 16l1 1L22 8" />,
  },
  submitted: {
    chip: 'border-border bg-surface-subtle text-text-2',
    icon: <path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M5 20h14" />,
  },
  // Neutral like submitted work: a speech bubble, someone's word. Deviation (AIV-P1-115): the Foundations artboard has no
  // chip for this look; it reuses the submitted chip's tokens with its own icon.
  interviewer: {
    chip: 'border-border bg-surface-subtle text-text-2',
    icon: <path d="M4 5h16v11H9l-5 4z" />,
  },
  claim: {
    chip: 'border-warn-border bg-warn-bg text-warn-text',
    icon: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </>
    ),
  },
  contradictory: {
    chip: 'border-err-border bg-err-bg text-err-text',
    icon: <path d="M12 3 21 12 12 21 3 12zM9.5 9.5l5 5M14.5 9.5l-5 5" />,
  },
  'awaiting-defence': {
    chip: 'border-info-border bg-info-bg text-info-text',
    icon: (
      <>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </>
    ),
  },
};

export type ProvenanceTagProps = {
  provenance: Provenance;
  /** The words, e.g. "Independently corroborated", from i18n. */
  label: string;
};

export function ProvenanceTag({ provenance, label }: ProvenanceTagProps) {
  const { chip, icon } = looks[provenance];
  return (
    <span
      className={cx(
        'inline-flex h-6.5 items-center gap-1.5 rounded-full border ps-1.75 pe-2.25 text-meta font-medium whitespace-nowrap',
        chip,
      )}
    >
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
        {icon}
      </svg>
      {label}
    </span>
  );
}
