// The one fold (AIV-P1-148, AIV-P1-161): text extracted from a PDF writes characters in compatibility forms (a
// ligature for "fi", fullwidth or mathematical bold letters), so a quote, a name or a trait word is compared on the
// folded text. A numeric character is never folded: a superscript or a circled digit is not the plain figure.
// shortcut: a look-alike letter of another script (a Cyrillic letter for a Latin "a") is not a compatibility form and
// is not folded, and a letter with a separate combining accent is not composed; widen if a pilot source shows one.

/** One character (a whole code point) as a quote is compared: its compatibility form folded, unless it is numeric. */
export const foldChar = (char: string): string =>
  char.charCodeAt(0) < 0x80 || /\p{N}/u.test(char) ? char : char.normalize('NFKC');

/**
 * The same fold for letters only, as identifiers and trait words are found: a symbol or punctuation mark keeps its
 * form, because folded it can read as a letter, a dot or a comma ("™" to "TM", a fullwidth full stop to ".") and
 * hide the edge of a name or a phone beside it.
 */
const foldLetter = (char: string): string => (/\p{L}/u.test(char) ? foldChar(char) : char);

/** Where the character that starts at `i` in `text` ends: a surrogate pair is one character. */
export const charEnd = (text: string, i: number): number => i + ((text.codePointAt(i) ?? 0) > 0xffff ? 2 : 1);

/** `text` with its letters folded, and for each code unit of `folded` the index in `text` of its character. */
export function foldLetters(text: string): { folded: string; at: number[] } {
  let folded = '';
  const at: number[] = [];
  let i = 0;
  for (const char of text) {
    const to = foldLetter(char);
    // One entry per code unit, so an offset never drifts when a character folds to several.
    for (let k = 0; k < to.length; k++) at.push(i);
    folded += to;
    i += char.length;
  }
  return { folded, at };
}

/** `text` with its letters folded, for the word checks on model output and job text. */
export const fold = (text: string): string => Array.from(text, foldLetter).join('');
