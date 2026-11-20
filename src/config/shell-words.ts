const SAFE_WORD = /^[\w@%+=:,./-]+$/;

/** A word as a POSIX shell takes it literally: bare when it can be, else in single quotes. */
export const shellQuoted = (word: string): string =>
  SAFE_WORD.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;

export const wordsText = (words: readonly string[]): string => words.map(shellQuoted).join(" ");

/**
 * The words of a line, read the way `wordsText` writes them and nothing more: no `$`, glob or `~`
 * expansion. Undefined when a quote is never closed.
 */
export function splitWords(text: string): string[] | undefined {
  const words: string[] = [];
  let word = "";
  let inWord = false;
  let quote: "'" | '"' | undefined;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;
    if (quote === "'") {
      if (char === "'") quote = undefined;
      else word += char;
    } else if (quote === '"') {
      const next = text[i + 1];
      if (char === '"') quote = undefined;
      else if (char === "\\" && (next === '"' || next === "\\")) {
        word += next;
        i += 1;
      } else word += char;
    } else if (/\s/.test(char)) {
      if (inWord) words.push(word);
      word = "";
      inWord = false;
    } else {
      inWord = true;
      if (char === "'" || char === '"') quote = char;
      else if (char === "\\" && i + 1 < text.length) {
        word += text[i + 1];
        i += 1;
      } else word += char;
    }
  }
  if (quote) return undefined;
  if (inWord) words.push(word);
  return words;
}
