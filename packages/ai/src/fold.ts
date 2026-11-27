// The one fold (AIV-P1-148, AIV-P1-161): text extracted from a PDF writes characters in compatibility forms (a
// ligature for "fi", fullwidth or mathematical bold letters), so a quote, a name or a trait word is compared on the
// folded text. A numeric character is never folded: a superscript or a circled digit is not the plain figure.
// Folding can also hide the edge of a word or a number (a trade mark sign reads as letters, a fullwidth full stop as a
// dot), so a check that must never miss reads the text as written as well as folded (matchesFolded, redactSources).
// shortcut: a look-alike letter of another script (a Cyrillic letter for a Latin "a") is not a compatibility form and
// is not folded, and a letter with a separate combining accent is not composed; widen if a pilot source shows one.

/** One character (a whole code point) as it is compared: its compatibility form folded, unless it is numeric. */
export const foldChar = (char: string): string =>
  char.charCodeAt(0) < 0x80 || /\p{N}/u.test(char) ? char : char.normalize('NFKC');

/** Where the character that starts at `i` in `text` ends: a surrogate pair is one character. */
export const charEnd = (text: string, i: number): number => i + ((text.codePointAt(i) ?? 0) > 0xffff ? 2 : 1);

/** `text` folded, and for each code unit of `folded` the index in `text` of the character it came from. */
export function foldLetters(text: string): { folded: string; at: number[] } {
  let folded = '';
  const at: number[] = [];
  let i = 0;
  for (const char of text) {
    const to = foldChar(char);
    // One entry per code unit, so an offset never drifts when a character folds to several.
    for (let k = 0; k < to.length; k++) at.push(i);
    folded += to;
    i += char.length;
  }
  return { folded, at };
}

/** `text` folded. */
export const fold = (text: string): string => Array.from(text, foldChar).join('');

/**
 * Whether a word check (not a global or sticky pattern) matches `text` as written or folded: both, because a folded
 * character beside a word can hide the word's edge ("age" before a fullwidth letter), so the fold only adds matches.
 */
export const matchesFolded = (pattern: RegExp, text: string): boolean => pattern.test(text) || pattern.test(fold(text));
