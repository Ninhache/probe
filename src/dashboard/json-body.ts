import type { CheckResult } from "../checkers/types";
import { JSON_FORMAT_MAX_BYTES } from "../constants";

export type JsonKind = "key" | "string" | "number" | "boolean" | "null" | "punct";
export interface JsonSpan {
  text: string;
  kind: JsonKind;
}

type Response = NonNullable<CheckResult["response"]>;

const INDENT = "  ";
const MEDIA_JSON = /(?:\/|\+)json$/i;

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

const QUOTE = 34;
const BACKSLASH = 92;
const isSpace = (c: number) => c === 32 || c === 10 || c === 13 || c === 9;
const isPunct = (c: number) =>
  c === 123 || c === 125 || c === 91 || c === 93 || c === 44 || c === 58;

/** The tokens of a text already known to be JSON, in one pass: each is `[start, end)`. */
function tokens(body: string): [number, number][] {
  const found: [number, number][] = [];
  const n = body.length;
  let i = 0;
  while (i < n) {
    const c = body.charCodeAt(i);
    if (isSpace(c)) i++;
    else if (isPunct(c)) found.push([i, ++i]);
    else {
      const start = i++;
      if (c === QUOTE) {
        while (i < n && body.charCodeAt(i) !== QUOTE) i += body.charCodeAt(i) === BACKSLASH ? 2 : 1;
        i++;
      } else {
        while (i < n) {
          const d = body.charCodeAt(i);
          if (isSpace(d) || isPunct(d) || d === QUOTE) break;
          i++;
        }
      }
      found.push([start, i]);
    }
  }
  return found;
}

function kindOf(first: number, text: string, colonNext: boolean): JsonKind {
  if (first === QUOTE) return colonNext ? "key" : "string";
  if (text === "true" || text === "false") return "boolean";
  return text === "null" ? "null" : "number";
}

/**
 * Re-lays out a JSON text in one linear pass. The text of every string and number is kept as it
 * was received, never decoded, so what the masking left in a body cannot come back (`\u0073` stays).
 */
function layout(body: string): JsonSpan[][] {
  const all = tokens(body);
  const lines: JsonSpan[][] = [[]];
  let depth = 0;
  const add = (text: string, kind: JsonKind) => lines.at(-1)?.push({ text, kind });
  const newline = () => {
    lines.push([]);
    if (depth > 0) add(INDENT.repeat(depth), "punct");
  };
  const at = (k: number) => (all[k] ? body.charCodeAt((all[k] as [number, number])[0]) : -1);
  for (let k = 0; k < all.length; k++) {
    const [start, end] = all[k] as [number, number];
    const c = body.charCodeAt(start);
    const text = body.slice(start, end);
    const next = at(k + 1);
    if (c === 123 || c === 91) {
      add(text, "punct");
      if (next === 125 || next === 93) continue;
      depth++;
      newline();
    } else if (c === 125 || c === 93) {
      const before = at(k - 1);
      if (before !== 123 && before !== 91) {
        depth--;
        newline();
      }
      add(text, "punct");
    } else if (c === 44) {
      add(text, "punct");
      newline();
    } else if (c === 58) add(": ", "punct");
    else add(text, kindOf(c, text, next === 58));
  }
  return lines;
}

interface View {
  lines?: JsonSpan[][];
  /** It is JSON by its look, but over the size cap: shown as received. */
  tooBig?: boolean;
}

const cache = new WeakMap<Response, View>();

/** What a response body is as JSON, worked out once per response and kept. */
function view(response: Response): View {
  const hit = cache.get(response);
  if (hit) return hit;
  const { body } = response;
  let found: View = {};
  if (body && !response.bodyCut && !response.bodyNote) {
    const declared = MEDIA_JSON.test(mediaType(contentType(response)));
    const sniffed = /^\s*[{[]/.test(body);
    if (declared || sniffed) {
      if (Buffer.byteLength(body) > JSON_FORMAT_MAX_BYTES) found = { tooBig: true };
      else if (valid(body)) found = { lines: layout(body) };
    }
  }
  cache.set(response, found);
  return found;
}

/**
 * The body of a response as pretty-printed JSON, line by line, or nothing when it is not JSON,
 * not all there or too big. It runs on the body as kept, already masked, and only once.
 */
export function jsonLines(response: Response | undefined): JsonSpan[][] | undefined {
  return response ? view(response).lines : undefined;
}

/** True when the body looks like JSON but is over the cap, so it is shown as received. */
export function jsonTooBig(response: Response | undefined): boolean {
  return response ? view(response).tooBig === true : false;
}

/** The pretty-printed body as text, for a copy. */
export function formattedBody(response: Response | undefined): string | undefined {
  return jsonLines(response)
    ?.map((line) => line.map((span) => span.text).join(""))
    .join("\n");
}

/** A line cut in pieces of `width` characters; a piece keeps the kinds of what it holds. */
export function foldSpans(line: readonly JsonSpan[], width: number): JsonSpan[][] {
  if (line.reduce((sum, span) => sum + span.text.length, 0) <= width) return [[...line]];
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
