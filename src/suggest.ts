/** Typos forgiven in a word, by its length: a short word one typo away from everything suggests nothing. */
const SHORT_WORD = 4;
const TYPOS_SHORT = 1;
const TYPOS_LONG = 2;

/** Number of typos between two words: a letter added, removed, replaced, or two neighbours swapped. */
export function typoDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  const at = (i: number, j: number) => rows[i]?.[j] ?? 0;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const same = a[i - 1] === b[j - 1];
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + (same ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, at(i - 2, j - 2) + 1);
      }
      (rows[i] as number[])[j] = best;
    }
  }
  return at(a.length, b.length);
}

/**
 * Returns the candidate the word was most likely meant to be, or `undefined` when none is close:
 * one typo at most for a candidate of 4 letters or fewer, two otherwise. The first of equal candidates wins.
 */
export function closest(word: string, candidates: readonly string[]): string | undefined {
  let found: { candidate: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = typoDistance(word.toLowerCase(), candidate);
    const allowed = candidate.length <= SHORT_WORD ? TYPOS_SHORT : TYPOS_LONG;
    if (distance > allowed || distance >= candidate.length) continue;
    if (!found || distance < found.distance) found = { candidate, distance };
  }
  return found?.candidate;
}
