import { describe, expect, it } from 'vitest';
import { activeOpsSection } from './ops.ts';

describe('activeOpsSection', () => {
  it.each([
    ['/ops', 'home'],
    ['/ops/workspaces', 'workspaces'],
    ['/ops/workspaces/3f0c1d5e-0000-4000-8000-000000000000', 'workspaces'],
    ['/ops/approvals', 'approvals'],
    ['/ops/catalogue', 'catalogue'],
    ['/ops/workspacesx', undefined],
    ['/app', undefined],
  ])('%s -> %s', (path, section) => expect(activeOpsSection(path)).toBe(section));
});
