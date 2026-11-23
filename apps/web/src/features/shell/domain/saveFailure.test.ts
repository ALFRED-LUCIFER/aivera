import { describe, expect, it } from 'vitest';
import { saveFailure } from './saveFailure.ts';

describe('saveFailure', () => {
  it('reads a 403 from the digest forbidden() sends to the browser', () => {
    expect(saveFailure(Object.assign(new Error('x'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;403' }))).toBe(
      'saveForbidden',
    );
  });

  it.each([
    new TypeError('Failed to fetch'),
    Object.assign(new Error('x'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' }),
    null,
    'x',
  ])('calls anything else a failed save: %s', (error) => expect(saveFailure(error)).toBe('saveFailed'));
});
