import { describe, expect, it, vi } from 'vitest';
import { directoryUseCases } from './directory.ts';

// AIV-P2-036: search and paging of the operator console's workspace list. Synthetic names (personas.md).
const at = (day: number) => new Date(Date.UTC(2026, 10, day));
const facts = (id: string, name: string, day: number) => ({
  id,
  name,
  type: 'in_house' as const,
  createdAt: at(day),
  synthetic: true,
  activeMembers: 1,
});
const stored = [
  facts('w3', 'Nadia Freelance', 3),
  facts('w2', 'Gulf Talent Partners', 2),
  facts('w1', 'Demo Hiring Co', 1),
];

const directory = (gone: string[] = []) => {
  const readSummary = vi.fn(async (id: string) =>
    gone.includes(id) ? null : (stored.find((s) => s.id === id) ?? null),
  );
  return { readSummary, ...directoryUseCases({ listIds: async () => stored.map((s) => s.id), readSummary }) };
};

describe('listSummaries', () => {
  it('lists every workspace newest first, each marked active', async () => {
    const { total, summaries } = await directory().listSummaries({ query: '', offset: 0, limit: 50 });
    expect(total).toBe(3);
    expect(summaries.map((s) => [s.name, s.status])).toEqual([
      ['Nadia Freelance', 'active'],
      ['Gulf Talent Partners', 'active'],
      ['Demo Hiring Co', 'active'],
    ]);
  });

  it('Scenario: Searching by name: matches part of the name in any case, ignoring surrounding spaces', async () => {
    const { total, summaries } = await directory().listSummaries({ query: '  GULF ', offset: 0, limit: 50 });
    expect(total).toBe(1);
    expect(summaries.map((s) => s.name)).toEqual(['Gulf Talent Partners']);
  });

  it('pages after matching: total counts every match, the page holds `limit` from `offset`', async () => {
    const { total, summaries } = await directory().listSummaries({ query: 'n', offset: 1, limit: 1 });
    expect(total).toBe(3);
    expect(summaries.map((s) => s.name)).toEqual(['Gulf Talent Partners']);
  });

  it('a search that matches nothing returns an empty page', async () => {
    expect(await directory().listSummaries({ query: 'zzz', offset: 0, limit: 50 })).toEqual({
      total: 0,
      summaries: [],
    });
  });

  it('skips a workspace deleted between the directory read and its own read', async () => {
    const { total, summaries } = await directory(['w2']).listSummaries({ query: '', offset: 0, limit: 50 });
    expect(total).toBe(2);
    expect(summaries.map((s) => s.id)).toEqual(['w3', 'w1']);
  });
});

describe('getSummary', () => {
  it('reads one workspace in its own scope, or null when there is none', async () => {
    const d = directory();
    expect(await d.getSummary('w2')).toEqual({ ...stored[1], status: 'active' });
    expect(await d.getSummary('missing')).toBeNull();
    expect(d.readSummary).toHaveBeenCalledWith('w2');
  });
});
