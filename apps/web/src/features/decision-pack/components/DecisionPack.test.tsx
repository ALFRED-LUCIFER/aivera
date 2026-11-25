// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PackPage } from '../domain/pack.ts';
import { DecisionPack } from './DecisionPack.tsx';

// AIV-P1-139: who added each member, on the pack page. Synthetic cast and ids only.
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const at = new Date('2026-11-17T08:00:00.000Z');
const member = (candidateId: string, name: string, added: PackPage['members'][number]['added']) => ({
  candidateId,
  name,
  backedScore: 55,
  upperBound: 67,
  added,
});

describe('DecisionPack: added by', () => {
  it('shows who added each member on the day in the workspace time zone, and no line on a member added before', () => {
    render(
      <IntlProvider {...intl}>
        <DecisionPack
          view={{
            status: 'ready',
            pack: {
              jobId: '0190d4a2-0000-7000-9000-000000000001',
              name: 'Round 2 shortlist',
              job: 'Senior AI Engineer',
              preparedAt: at,
              rubricVersion: 2,
              members: [
                // 21:30 UTC is 25 Nov in Dubai.
                member('p1', 'Sara Al Qahtani', { by: 'Ayesha Perera', at: new Date('2026-11-24T21:30:00.000Z') }),
                member('p2', 'Arjun Menon', null),
              ],
              others: 0,
            },
          }}
        />
      </IntlProvider>,
    );
    expect(screen.getByText('Added by Ayesha Perera on 25 Nov 2026')).toBeTruthy();
    expect(screen.getAllByText(/^Added by/)).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Arjun Menon' })).toBeTruthy();
  });
});
