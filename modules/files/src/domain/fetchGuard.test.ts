import { describe, expect, it } from 'vitest';
import { checkFetchUrl, cvContentType, isRefusedAddress } from './fetchGuard.ts';

// AIV-P1-103: the SSRF guard of a sheet's CV links. Hosts are synthetic (.credalent.example). The redirect and
// resolved-address checks run over a real HTTPS client in tests/integration/src/cv-link-fetch.test.ts.

describe('Scenario Outline: CV links that are not HTTPS to a public host are refused', () => {
  it('refuses a non-https scheme and credentials before any lookup', () => {
    expect(checkFetchUrl('http://cv.credalent.example/a.pdf')).toBeNull();
    expect(checkFetchUrl('ftp://cv.credalent.example/a.pdf')).toBeNull();
    expect(checkFetchUrl('https://user:pass@cv.credalent.example/a.pdf')).toBeNull();
    // Review finding: a non-standard port reaches internal services on public addresses.
    expect(checkFetchUrl('https://cv.credalent.example:8443/a.pdf')).toBeNull();
    expect(checkFetchUrl('https://cv.credalent.example:443/a.pdf')?.port).toBe('');
    expect(checkFetchUrl('not a url')).toBeNull();
    expect(checkFetchUrl('https://cv.credalent.example/a.pdf')?.hostname).toBe('cv.credalent.example');
  });

  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '169.254.169.254',
    '172.16.4.1',
    '192.168.1.10',
    '100.64.0.7',
    '0.0.0.0',
    '168.63.129.16',
    '::1',
    '::ffff:10.0.0.5',
    'fe80::1',
    'fec0::1',
    'fd00::1',
    'not-an-address',
  ])('refuses %s', (address) => {
    expect(isRefusedAddress(address)).toBe(true);
  });

  it.each(['93.184.215.14', '2606:4700::1111'])('allows the public address %s', (address) => {
    expect(isRefusedAddress(address)).toBe(false);
  });
});

describe('Only a PDF or Word file is kept as a CV', () => {
  const pdf = Buffer.from('%PDF-1.7\nsynthetic');
  it.each([
    ['application/pdf', Buffer.from('x'), 'application/pdf'],
    ['application/pdf; charset=binary', Buffer.from('x'), 'application/pdf'],
    [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      Buffer.from('PK'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    ['application/octet-stream', pdf, 'application/pdf'],
    ['text/html', Buffer.from('<html>'), null],
    ['', Buffer.from('MZ'), null],
  ] as const)('declared "%s"', (declared, data, expected) => {
    expect(cvContentType(declared, data)).toBe(expected);
  });
});
