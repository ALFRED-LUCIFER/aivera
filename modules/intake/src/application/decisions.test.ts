import type { Tx } from '@credalent/db';
import { describe, expect, it, vi } from 'vitest';
import type { Application, RecordedDecision, Stage } from '../domain/application.ts';
import type { IntakeStore } from './applications.ts';
import { applyDecisions, type DecisionStagePorts } from './decisions.ts';

const W = '0190d4a2-0000-7000-8000-0000000000w1';
const JOB = '0190d4a2-0000-7000-8000-000000000j0b';
const PACK = '0190d4a2-0000-7000-8000-00000000pac1';
const HASSAN = '0190d4a2-0000-7000-8000-0000000a55a0';
const tx = {} as Tx;

const decided = (candidateId: string, decision: RecordedDecision['decision']): RecordedDecision => ({
  candidateId,
  decision,
  decidedBy: HASSAN,
  note: 'Strong on the two heaviest competencies.',
});

/** One application per person on the job, at `stage`; records the store calls and audits in order. */
function setup(stages: Record<string, Stage>, decisions: RecordedDecision[]) {
  const calls: string[] = [];
  const applications = new Map<string, Application>(
    Object.entries(stages).map(([personId, stage]) => [
      personId,
      {
        id: `app-${personId}`,
        workspaceId: W,
        personId,
        jobId: JOB,
        stage,
        receivedAt: new Date(),
        submittedToClientAt: null,
      },
    ]),
  );
  const store = {
    findForPersonAndJob: async (_w: string, personId: string) => applications.get(personId) ?? null,
    moveStage: async (_w: string, id: string, from: Stage, to: Stage) => {
      calls.push(`move ${id} ${from}->${to}`);
      return true;
    },
  } as unknown as IntakeStore;
  const auditStageChanged = vi.fn<DecisionStagePorts['auditStageChanged']>(async (_tx, _w, change) => {
    calls.push(`audit ${change.applicationId}`);
  });
  const ports: DecisionStagePorts = { storeFor: () => store, decisionsOf: async () => decisions, auditStageChanged };
  return { calls, auditStageChanged, run: () => applyDecisions(ports, tx, W, { packId: PACK, jobId: JOB }) };
}

describe('Scenario: Record decisions: stages follow the recorded decisions', () => {
  it('advance moves to the Round 2 shortlist and do not advance to not advanced; each move is audited after all of them', async () => {
    const { calls, auditStageChanged, run } = setup({ sara: 'interview', arjun: 'interview' }, [
      decided('sara', 'advance'),
      decided('arjun', 'do_not_advance'),
    ]);
    await run();
    expect(calls).toEqual([
      'move app-sara interview->round2_shortlist',
      'move app-arjun interview->not_advanced',
      'audit app-sara',
      'audit app-arjun',
    ]);
    expect(auditStageChanged).toHaveBeenCalledWith(tx, W, {
      applicationId: 'app-sara',
      jobId: JOB,
      packId: PACK,
      from: 'interview',
      to: 'round2_shortlist',
      decidedBy: HASSAN,
      note: 'Strong on the two heaviest competencies.',
    });
  });

  // SAFETY: mutation check: dropped `application.stage === to` from the skip -> this test failed (a second move and audit)
  it('a hold, an application already at its stage, a withdrawn one and a person with no application are left alone', async () => {
    const { calls, run } = setup({ sara: 'round2_shortlist', arjun: 'interview', huda: 'withdrawn' }, [
      decided('sara', 'advance'),
      decided('arjun', 'hold'),
      decided('huda', 'advance'),
      decided('daniel', 'do_not_advance'),
    ]);
    await run();
    expect(calls).toEqual([]);
  });
});
