import { z } from 'zod';
import { cited, type Source } from '../citations.ts';

// "Parse a CV into claims" (AIV-P1-025, ADR-006 point 2): the prompt and schema, versioned here so every change runs
// the eval set (evals/evidence.parseCv/). The evidence module's worker job calls it with the text Document Intelligence
// extracted as the one `cv` source; the eval runner the same. The skill and date lines are adapted from Resume-Matcher
// (Apache-2.0, modified): THIRD_PARTY_NOTICES.md.

/** Bump with any change to the system prompt, the prompt or the schema; it goes on telemetry and the eval results. */
export const PARSE_CV_VERSION = 'evidence.parseCv@3'; // bumped by AIV-P1-080: sources reach the model redacted (identifiers.ts)

export const PARSE_CV_SYSTEM = [
  "You read one candidate's CV and list what it says, so a recruiter can see each statement next to the CV line it",
  'comes from. Nothing you list is treated as proven.',
  'workHistory: one entry per role: the role and employer as written, and its dates as written, or null when none.',
  'Keep months when the CV has them ("Jun 2020 - Aug 2023", "May 2021 - Present"); write years only when the CV has',
  'no months. Never discard months. Cite the line that names the role.',
  'skills: copy every skill, tool, framework, programming language and technology the CV lists, one item each, in the',
  'original wording. Split a comma-separated list into separate items. Never summarise, merge, shorten or drop skills,',
  'however long the list is. Spoken languages are not skills.',
  'statements: each achievement, responsibility, education entry, certification and award, one per item, in the',
  "CV's own words. Cite each item with a quote that contains it.",
  "contact: the candidate's own email addresses and phone numbers exactly as the CV writes them, never a referee's or",
  "anyone else's; never put contact details in any other field.",
].join(' ');

const text = z.string().min(1).max(400);

// Azure strict mode needs every property present: .nullable(), never .optional() (client.ts generateStructured).
export const parseCvSchema = z.object({
  contact: z.object({ emails: z.array(z.string().max(254)), phones: z.array(z.string().max(40)) }),
  workHistory: z.array(cited(z.object({ role: text, dates: z.string().max(80).nullable() }))),
  skills: z.array(cited(z.object({ skill: z.string().min(1).max(80) }))),
  statements: z.array(cited(z.object({ text }))),
});

/**
 * The whole request but its workspace, so the evidence module and the eval runner send the same thing. The CV text is
 * the only source, so the prompt holds no candidate data; the client replaces the name in it and keeps its emails and phones (identifiers.ts CONTACT_EXTRACTION_TASKS). A statement citing text not in the CV is dropped, not the
 * whole answer (`dropInvalidCitations`).
 */
export const parseCvRequest = (sources: readonly Source[]) => ({
  task: 'evidence.parseCv' as const,
  promptVersion: PARSE_CV_VERSION,
  system: PARSE_CV_SYSTEM,
  prompt: 'List the work history, skills, statements and contact details of the CV in the source.',
  schema: parseCvSchema,
  sources,
  dropInvalidCitations: true,
});
