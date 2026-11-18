export type HeaderTemplates = Readonly<Record<string, string>>;

export type VariableLookup = (name: string) => string | undefined;

// RFC 9110 `token`: what a header name is made of.
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
// Tab, visible ASCII and Latin-1: what `fetch` agrees to send.
const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/;
export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REFERENCE = /\$\{([^}]*)\}/g;

/** The request has no body, and `fetch` refuses to send these. */
const UNSENDABLE = new Set(["content-length", "transfer-encoding"]);

// By name, so a header nobody listed (`X-Api-Key`, `X-Auth-Token`) is covered too.
const SENSITIVE_NAME = /auth|cookie|token|secret|key|session|password|credential/i;

/** A value shorter than this is not masked on screen: it would hide ordinary text. */
const MASKED_MIN_LENGTH = 4;
export const MASK = "***";

export const reference = (name: string) => `\${${name}}`;

// A closed list: whatever is kept as a scheme is written in clear in config.yml.
const AUTH_SCHEME = /^(?:Bearer|Basic|Token)\s+(?=\S)/i;

export function splitSecret(value: string): { scheme: string; secret: string } {
  const scheme = AUTH_SCHEME.exec(value)?.[0] ?? "";
  return { scheme, secret: value.slice(scheme.length) };
}

export function holdsSecret(name: string, value: string): boolean {
  return isSensitiveHeader(name) && !value.includes("${");
}

// Only a closed reference is drawn: a secret followed by `${` stays hidden while the name is typed.
export function hiddenHeaderLine(line: string, bullet: string): string {
  const colon = line.indexOf(":");
  if (colon < 1 || !isSensitiveHeader(line.slice(0, colon).trim())) return line;
  const value = line.slice(colon + 1).trimStart();
  const { scheme, secret } = splitSecret(value);
  const hidden = templateParts(secret).map(({ text, variable }) =>
    variable !== undefined && VARIABLE_NAME.test(variable)
      ? reference(variable)
      : bullet.repeat((text ?? reference(variable ?? "")).length),
  );
  return `${line.slice(0, line.length - value.length)}${scheme}${hidden.join("")}`;
}

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_NAME.test(name);
}

export function referencedVariables(value: string): string[] {
  return [...new Set(Array.from(value.matchAll(REFERENCE), (match) => match[1] as string))];
}

export function serviceVariables(headers: HeaderTemplates | undefined): string[] {
  return [...new Set(Object.values(headers ?? {}).flatMap(referencedVariables))];
}

export function headerNameProblem(name: string): string | undefined {
  if (!HEADER_NAME.test(name)) return "a header name, e.g. Authorization or X-Api-Key";
  if (UNSENDABLE.has(name.toLowerCase())) return "a header a request without a body can carry";
  return undefined;
}

// The value is never repeated: it may be the secret.
export function headerValueProblem(name: string, value: string): string | undefined {
  if (!HEADER_VALUE.test(value)) return "a value on one line, without unusual characters";
  if (value.includes("${") && !referencedVariables(value).every((v) => VARIABLE_NAME.test(v))) {
    return `a variable name between braces, e.g. ${reference("API_TOKEN")}`;
  }
  // config.yml is shared: nothing secret goes in it.
  if (isSensitiveHeader(name) && referencedVariables(value).length === 0) {
    return `a reference instead of the secret, e.g. Bearer ${reference("API_TOKEN")}: config.yml is shared`;
  }
  return undefined;
}

export function variableValueProblem(value: string): string | undefined {
  if (value === "") return "a value: an empty one sets nothing";
  if (!HEADER_VALUE.test(value)) return "a value on one line, without unusual characters";
  return undefined;
}

export function parseHeaderLine(line: string): [name: string, value: string] | undefined {
  const colon = line.indexOf(":");
  if (colon < 1) return undefined;
  return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
}

export type ResolvedHeaders =
  | {
      headers: [name: string, value: string][];
      secrets: string[];
      /** Each secret value with the variable it came from. */
      references: [secret: string, variable: string][];
    }
  | { unset: string[] }
  | { unsendable: string[] };

export function resolveHeaders(
  templates: HeaderTemplates,
  lookup: VariableLookup,
): ResolvedHeaders {
  const names = serviceVariables(templates);
  const values = new Map(names.map((name) => [name, lookup(name)]));
  const unset = names.filter((name) => !values.get(name));
  if (unset.length > 0) return { unset };
  const unsendable = names.filter((name) => !HEADER_VALUE.test(values.get(name) as string));
  if (unsendable.length > 0) return { unsendable };
  return {
    headers: Object.entries(templates).map(([name, template]) => [
      name,
      template.replace(REFERENCE, (_, variable: string) => values.get(variable) as string),
    ]),
    secrets: [...values.values()].filter(
      (value): value is string => value !== undefined && value.length >= MASKED_MIN_LENGTH,
    ),
    references: [...values]
      .filter((pair): pair is [string, string] => (pair[1]?.length ?? 0) >= MASKED_MIN_LENGTH)
      .map(([variable, value]) => [value, variable]),
  };
}

/** Replaces every secret found in a text, longest first so one inside another leaves nothing. */
export function masked(text: string, secrets: readonly string[]): string {
  return [...secrets]
    .sort((a, b) => b.length - a.length)
    .reduce((hidden, secret) => hidden.replaceAll(secret, MASK), text);
}

/** Puts the `${NAME}` it came from where a secret is echoed, longest secret first. */
export function referenced(text: string, references: readonly [string, string][]): string {
  const known = new Map(references);
  const found = [...known.keys()]
    .sort((a, b) => b.length - a.length)
    .map((secret) => secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (found.length === 0) return text;
  return text.replace(new RegExp(found.join("|"), "g"), (secret) =>
    reference(known.get(secret) as string),
  );
}

export function templateParts(value: string): { text?: string; variable?: string }[] {
  const parts: { text?: string; variable?: string }[] = [];
  let end = 0;
  for (const match of value.matchAll(REFERENCE)) {
    if (match.index > end) parts.push({ text: value.slice(end, match.index) });
    parts.push({ variable: match[1] });
    end = match.index + match[0].length;
  }
  if (end < value.length) parts.push({ text: value.slice(end) });
  return parts;
}
