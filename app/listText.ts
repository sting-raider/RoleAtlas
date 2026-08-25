// Comma/newline-separated list editing without fighting the keyboard.
//
// The onboarding and strategy forms used to parse every keystroke into a
// string array and re-render the input from that array. Any trailing space,
// trailing comma, or mid-word comma was therefore deleted the moment it was
// typed, because split→trim→filter(Boolean) discarded it before the next
// render. These helpers invert the flow: the input owns its raw text, and
// parsing happens only for validation or persistence — never for redisplay.

export function splitList(raw: string): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const candidate of raw.split(/[,\n]/)) {
    const value = candidate.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }
  return values;
}

export function joinList(values: readonly string[]): string {
  return values.join(", ");
}

/**
 * True when the parsed list equals the committed list, i.e. the raw text is
 * only whitespace/case/delimiter noise away from what is already stored.
 * Used to keep an input's raw buffer while the user is still typing ("data,
 * " must not collapse to ["data"] in the box) and to detect genuine external
 * changes (résumé import) worth resyncing from.
 */
export function rawMatchesList(raw: string, values: readonly string[]): boolean {
  const parsed = splitList(raw);
  return (
    parsed.length === values.length &&
    parsed.every((value, index) => value.toLowerCase() === values[index]?.toLowerCase())
  );
}
