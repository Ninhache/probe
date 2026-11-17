/**
 * The choice next to `current`, or the one a typed letter picks. The same letter again moves on
 * to the next choice starting with it: POST, PUT and PATCH all start with P.
 * An empty `current` stands for the first choice.
 */
export function nextChoice(
  choices: readonly string[],
  current: string,
  step: 1 | -1 | string,
): string {
  const at = Math.max(0, choices.indexOf(current));
  if (typeof step === "number")
    return choices[(at + step + choices.length) % choices.length] ?? current;
  const letter = step.toLowerCase();
  const starting = choices.filter((choice) => choice.toLowerCase().startsWith(letter));
  const next = starting.indexOf(choices[at] ?? "") + 1;
  return starting[next % starting.length] ?? current;
}

/** The keys that choose, with the list when it fits in `room`. */
export function choiceHint(choices: readonly string[], room = Number.POSITIVE_INFINITY): string {
  const listed = `←→ or a letter: ${choices.join(", ")}`;
  return listed.length <= room ? listed : "←→ or a first letter, again for the next";
}
