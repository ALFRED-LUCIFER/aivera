// The one letter fold (AIV-P1-148, AIV-P1-161): text extracted from a PDF writes letters in compatibility forms (the
// ligature "ﬁ" for "fi", fullwidth or mathematical bold letters), so a quote, a name or a trait word is compared
// on the folded text. A numeric character is never folded: a superscript or a circled digit is not the plain figure.
// shortcut: a look-alike letter of another script (a Cyrillic "а" for a Latin "a") is not a compatibility form and is
// not folded; add a confusables map if a pilot source shows one.

/** One character (a whole code point) as it is compared. */
export const foldChar = (char: string): string =>
  char < '\u0080' || /\p{N}/u.test(char) ? char : char.normalize('NFKC');

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

/** The folded text alone, for the word checks on model output and job text. */
export const fold = (text: string): string => foldLetters(text).folded;
