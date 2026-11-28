import { describe, expect, it } from 'vitest';
import { isValidMapping, parseCsv, proposeMapping, readRows } from './sheet.ts';

// AIV-P1-103: the mapping proposal and row checks of a sheet import. Synthetic cast (docs/00-product/personas.md) and
// @example.com addresses; portfolio hosts on .credalent.example.

describe('Scenario: Map the columns and import: the proposed mapping', () => {
  it('maps "Full name", "E-mail" and "Resume URL" whatever their case and punctuation', () => {
    expect(proposeMapping(['Full name', 'E-mail', 'Resume URL'])).toEqual({
      name: 0,
      email: 1,
      cvLink: 2,
      phone: null,
    });
    expect(proposeMapping(['Mobile', 'EMAIL ADDRESS', 'Candidate', 'Résumé'])).toEqual({
      name: 2,
      email: 1,
      cvLink: 3,
      phone: 0,
    });
  });

  it('leaves a field it cannot place for the recruiter to pick', () => {
    expect(proposeMapping(['Applied on', 'Contact'])).toEqual({ name: null, email: null, cvLink: null, phone: null });
  });

  it('accepts only a mapping inside the header row with no column used twice', () => {
    expect(isValidMapping({ name: 0, email: 1, cvLink: 2, phone: null }, 3)).toBe(true);
    expect(isValidMapping({ name: 0, email: 0, cvLink: null, phone: null }, 3)).toBe(false);
    expect(isValidMapping({ name: 0, email: 3, cvLink: null, phone: null }, 3)).toBe(false);
    expect(isValidMapping({ name: -1, email: 1, cvLink: null, phone: null }, 3)).toBe(false);
  });
});

describe('parseCsv', () => {
  it('reads quoted fields, doubled quotes, commas and line breaks in quotes, CRLF and a BOM', () => {
    expect(parseCsv('﻿Name,Note\r\n"Al Qahtani, Sara","said ""hi""\nthen left"\r\nOmar Haddad,\n')).toEqual([
      ['Name', 'Note'],
      ['Al Qahtani, Sara', 'said "hi"\nthen left'],
      ['Omar Haddad', ''],
    ]);
  });

  it('keeps a last line with no line break', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('Scenario Outline: Rows that cannot be used are explained by row number', () => {
  const mapping = { name: 0, email: 1, cvLink: 2, phone: 3 };
  const cells = [
    ['Full name', 'E-mail', 'Resume URL', 'Phone'],
    ['Sara Al Qahtani', 'Sara.AlQahtani@Example.com', 'https://cv.credalent.example/sara.pdf', '+971 50 000 0001'],
    ['', '', '', ''],
    ['Omar Haddad', '', '', ''],
    ['', 'nameless@example.com', '', ''],
    ['Lina Saleh', 'not-an-email', '', '050 1234'],
  ];

  it('gives each row its sheet row number, a problem row no values, and a valid person their identifiers', () => {
    const { rows, links } = readRows(cells, mapping);
    expect(rows).toEqual([
      {
        row: 2,
        problem: null,
        name: 'Sara Al Qahtani',
        email: 'sara.alqahtani@example.com',
        phone: '+971500000001',
        cv: 'none',
      },
      { row: 4, problem: 'missing_email' },
      { row: 5, problem: 'missing_name' },
      { row: 6, problem: 'invalid_email' },
    ]);
    expect([...links]).toEqual([[2, 'https://cv.credalent.example/sara.pdf']]);
  });

  it('leaves out a phone that is not international and an unmapped column', () => {
    const { rows } = readRows(
      [
        ['Name', 'Email', 'Phone'],
        ['Omar Haddad', 'omar.haddad@example.com', '050 1234'],
      ],
      { name: 0, email: 1, cvLink: null, phone: 2 },
    );
    expect(rows).toEqual([
      { row: 2, problem: null, name: 'Omar Haddad', email: 'omar.haddad@example.com', phone: null, cv: 'none' },
    ]);
  });
});
