import { describe, expect, it } from 'vitest';
import { historyPage, historyPageCount, versionNumber, versionsHref } from './catalogueHistory.ts';

// AIV-P2-050: the history's URL numbers and pages.
describe('catalogue history URLs', () => {
  it('reads a page number, 1 when absent, and refuses anything else', () => {
    expect(historyPage(undefined)).toBe(1);
    expect(historyPage('2')).toBe(2);
    for (const bad of ['0', '-1', '1.5', '02', 'two', '', '10001', ['1', '2']]) expect(historyPage(bad)).toBeNull();
  });

  it('reads a version number and refuses anything else, an int4 overflow included', () => {
    expect(versionNumber('99')).toBe(99);
    for (const bad of ['0', 'v2', '2.0', '1e3', '2147483648']) expect(versionNumber(bad)).toBeNull();
  });

  it('pages by 20, at least one page, and page 1 has no query', () => {
    expect([0, 20, 21].map(historyPageCount)).toEqual([1, 1, 2]);
    expect(versionsHref(1)).toBe('/ops/catalogue/versions');
    expect(versionsHref(2)).toBe('/ops/catalogue/versions?page=2');
  });
});
