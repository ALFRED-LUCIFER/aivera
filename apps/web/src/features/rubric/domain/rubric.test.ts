import type { Rubric } from '@aivera/jobs';
import { describe, expect, it } from 'vitest';
import { approverView, canSave, newCompetency, reviewLink, reviewPath, rubricView, weightsTotal } from './rubric.ts';

const HEAD = 'head-id';
const at = new Date('2026-11-12T08:00:00.000Z');
const version = (n: number, status: Rubric['status'], more: Partial<Rubric> = {}): Rubric =>
  ({
    version: n,
    status,
    successStatement: `v${n}`,
    changeNote: null,
    approvedBy: null,
    approvedAt: null,
    competencies: [],
    ...more,
  }) as Rubric;

const named = (weightPercent: number) => ({ ...newCompetency(), name: 'Delivery', weightPercent });

describe('Rubric page view (AIV-P1-012)', () => {
  it('shows the approved version; a superseded version carries the change that replaced it', () => {
    const view = rubricView(
      [
        version(3, 'draft', { changeNote: 'Cost and reliability raised from 15% to 20%.' }),
        version(2, 'approved', {
          approvedBy: HEAD,
          approvedAt: at,
          changeNote: 'Product judgement raised from 10% to 15%; Arabic NLP changed to desirable.',
        }),
        version(1, 'superseded', { approvedBy: HEAD, approvedAt: at }),
      ],
      new Map([[HEAD, 'Head of Engineering']]),
    );
    expect(view.shown?.successStatement).toBe('v2');
    expect(view.history).toEqual([
      { version: 3, status: 'draft', approved: null, note: 'Cost and reliability raised from 15% to 20%.' },
      { version: 2, status: 'approved', approved: { by: 'Head of Engineering', at }, note: null },
      {
        version: 1,
        status: 'superseded',
        approved: null,
        note: 'Product judgement raised from 10% to 15%; Arabic NLP changed to desirable.',
      },
    ]);
  });

  it('a returned version in between: the superseded one shows the note of the version that was approved', () => {
    const history = rubricView(
      [
        version(3, 'approved', { approvedBy: HEAD, approvedAt: at, changeNote: 'Cost and reliability raised.' }),
        version(2, 'returned', { changeNote: 'Python lowered.' }),
        version(1, 'superseded', { approvedBy: HEAD, approvedAt: at }),
      ],
      new Map(),
    ).history;
    expect(history.map((h) => h.note)).toEqual([null, 'Python lowered.', 'Cost and reliability raised.']);
    // An approver whose name cannot be read is left out, never shown as an empty name.
    expect(history[0]?.approved).toEqual({ by: null, at });
  });

  it('with none approved, shows the latest draft; with no versions, nothing', () => {
    expect(rubricView([version(1, 'draft')], new Map()).shown?.version).toBe(1);
    expect(rubricView([], new Map())).toEqual({ shown: null, history: [], edit: null, review: null });
  });

  it('edit mode opens the open version, so a second editor resumes it, or else the approved one (AIV-P1-013)', () => {
    const approved = version(2, 'approved', { id: 'v2', revision: 0 });
    expect(rubricView([approved], new Map()).edit?.base).toEqual({ versionId: 'v2', revision: 0 });
    const open = version(3, 'awaiting_approval', { id: 'v3', revision: 4 });
    expect(rubricView([open, approved], new Map()).edit?.base).toEqual({ versionId: 'v3', revision: 4 });
  });

  it('the version awaiting approval is what the approver reviews, with what changed since the approved one (AIV-P1-014)', () => {
    const approved = version(2, 'approved', { id: 'v2', approvedBy: HEAD, approvedAt: at, successStatement: 'old' });
    const awaiting = version(3, 'awaiting_approval', {
      id: 'v3',
      revision: 2,
      changeNote: 'Arabic NLP changed to desirable.',
    });
    const view = rubricView([awaiting, approved], new Map());
    expect(view.review).toMatchObject({ versionId: 'v3', revision: 2, version: 3, approvedVersion: 2 });
    // The recruiter keeps reading the approved version; the approver reads the one they decide on.
    expect(view.shown?.version).toBe(2);
    expect(approverView(view, null).rubric.shown?.version).toBe(3);
    expect(rubricView([version(3, 'draft'), approved], new Map()).review).toBeNull();
  });

  it('Scenario: Approving an outdated version is refused: an older link than the copy awaiting approval is outdated', () => {
    const view = rubricView([version(3, 'awaiting_approval', { id: 'v3', revision: 2 })], new Map());
    expect(approverView(view, { versionId: 'v3', revision: 2 }).outdatedLink).toBe(false);
    expect(approverView(view, { versionId: 'v3', revision: 1 }).outdatedLink).toBe(true);
    expect(approverView(view, { versionId: 'v2', revision: 2 }).outdatedLink).toBe(true);
    expect(approverView(view, null).outdatedLink).toBe(false);
  });

  it('the approval link carries opaque ids only, and a malformed one is ignored', () => {
    const versionId = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    const path = reviewPath('job', { versionId, revision: 3 });
    expect(path).toBe(`/app/jobs/job/rubric?version=${versionId}&revision=3`);
    expect(reviewLink(Object.fromEntries(new URL(path, 'https://aivera.example').searchParams))).toEqual({
      versionId,
      revision: 3,
    });
    expect(reviewLink({ version: 'x', revision: '1' })).toBeNull();
    expect(reviewLink({})).toBeNull();
  });

  it("a returned version shows the hiring owner's note", () => {
    const [entry] = rubricView(
      [version(2, 'returned', { returnNote: 'Arabic NLP should be desirable' })],
      new Map(),
    ).history;
    expect(entry?.returnNote).toBe('Arabic NLP should be desirable');
  });

  it('saving needs weights totalling 100, each 1 to 100, and every competency named', () => {
    expect(canSave([named(60), named(40)])).toBe(true);
    expect(canSave([named(60), named(35)])).toBe(false);
    expect(canSave([named(100), { ...named(0) }])).toBe(false);
    expect(canSave([named(60), { ...named(40), name: ' ' }])).toBe(false);
    expect(canSave([])).toBe(false);
  });

  it('totals the weights', () => {
    expect(weightsTotal([25, 20, 15, 15, 10, 15].map((weightPercent) => ({ weightPercent })))).toBe(100);
  });
});
