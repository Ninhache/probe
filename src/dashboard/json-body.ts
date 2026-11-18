import type { CheckResult } from "../checkers/types";

export type JsonKind = "key" | "string" | "number" | "boolean" | "null" | "punct";
export interface JsonSpan {
  text: string;
  kind: JsonKind;
}

type Response = NonNullable<CheckResult["response"]>;

const INDENT = "  ";
const MEDIA_JSON = /(?:\/|\+)json$/i;
const TOKEN = /"(?:[^"\\]|\\.)*"|-?\d[\d.eE+-]*|true|false|null|[{}[\],:]/g;

const contentType = (response: Response) =>
  response.headers.find(([name]) => name.toLowerCase() === "content-type")?.[1];

const mediaType = (type: string | undefined) => (type ?? "").split(";")[0]?.trim() ?? "";

function valid(body: string): boolean {
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}

function kindOf(token: string, next: string | undefined): JsonKind {
  if (token.startsWith('"')) return next === ":" ? "key" : "string";
  if (token === "true" || token === "false") return "boolean";
  if (token === "null") return "null";
  return /^[{}[\],:]$/.test(token) ? "punct" : "number";
}

/**
 * Re-lays out a JSON text one token at a time. The text of every string and number is kept as it
 * was received, never decoded, so what the masking left in a body cannot come back (`s` stays).
 */
function layout(body: string): JsonSpan[][] {
  const tokens = body.match(TOKEN) ?? [];
  const lines: JsonSpan[][] = [[]];
  let depth = 0;
  const add = (text: string, kind: JsonKind) => lines.at(-1)?.push({ text, kind });
  const newline = () => {
    lines.push([]);
    if (depth > 0) add(INDENT.repeat(depth), "punct");
  };
  tokens.forEach((token, i) => {
    const next = tokens[i + 1];
    if (token === "{" || token === "[") {
      add(token, "punct");
      if (next === "}" || next === "]") return;
      depth++;
      newline();
    } else if (token === "}" || token === "]") {
      if (tokens[i - 1] !== "{" && tokens[i - 1] !== "[") {
        depth--;
        newline();
      }
      add(token, "punct");
    } else if (token === ",") {
      add(token, "punct");
      newline();
    } else if (token === ":") add(": ", "punct");
    else add(token, kindOf(token, next));
  });
  return lines;
}

const cache = new WeakMap<Response, JsonSpan[][] | null>();

/**
 * The body of a response as pretty-printed JSON, line by line, or nothing when it is not JSON
 * or not all there. It runs on the body as kept, already masked.
 */
export function jsonLines(response: Response | undefined): JsonSpan[][] | undefined {
  if (!response) return undefined;
  const hit = cache.get(response);
  if (hit !== undefined) return hit ?? undefined;
  const { body } = response;
  let lines: JsonSpan[][] | null = null;
  if (body && !response.bodyCut && !response.bodyNote) {
    const declared = MEDIA_JSON.test(mediaType(contentType(response)));
    const sniffed = /^\s*[{[]/.test(body);
    if ((declared || sniffed) && valid(body)) lines = layout(body);
  }
  cache.set(response, lines);
  return lines ?? undefined;
}

/** The pretty-printed body as text, for a copy. */
export function formattedBody(response: Response | undefined): string | undefined {
  return jsonLines(response)
    ?.map((line) => line.map((span) => span.text).join(""))
    .join("\n");
}

/** A line cut in pieces of `width` characters; a piece keeps the kinds of what it holds. */
export function foldSpans(line: readonly JsonSpan[], width: number): JsonSpan[][] {
  const pieces: JsonSpan[][] = [[]];
  let used = 0;
  for (const span of line) {
    for (const letter of Array.from(span.text)) {
      if (used === width) {
        pieces.push([]);
        used = 0;
      }
      const piece = pieces.at(-1) as JsonSpan[];
      const last = piece.at(-1);
      if (last?.kind === span.kind) last.text += letter;
      else piece.push({ text: letter, kind: span.kind });
      used++;
    }
  }
  return pieces;
}
