import { RESPONSE_BODY_BYTES, RESPONSE_BODY_WAIT_MS } from "../constants";

export interface ResponseDetail {
  statusText: string;
  headers: [name: string, value: string][];
  body?: string;
  bodyCut?: true;
  bodyNote?: string;
}

export const HIDDEN_VALUE = "(hidden)";

// By name, so a header nobody listed (`x-api-key`, `x-session-id`) is covered too.
const SENSITIVE_HEADER = /auth|cookie|token|secret|key|session|password|credential/i;
const TEXT_TYPE = /^text\/|json|xml|javascript|yaml|x-www-form-urlencoded/i;

const NUL = 0;
const FIRST_PRINTABLE = 32;
const DELETE = 127;
const LAST_C1_CONTROL = 159;
const REPLACEMENT = "�";

function isControl(character: string): boolean {
  const code = character.codePointAt(0) ?? NUL;
  return code < FIRST_PRINTABLE || (code >= DELETE && code <= LAST_C1_CONTROL);
}

/** Removes what a terminal would obey instead of showing: a server could repaint the screen with it. */
function printable(text: string, kept = ""): string {
  return Array.from(text)
    .filter((character) => kept.includes(character) || !isControl(character))
    .join("");
}

// Waits a short time only: a body that never ends, or comes drop by drop, must not hold the checks.
async function readStart(
  body: ReadableStream<Uint8Array>,
  limit: number,
): Promise<{ bytes: Uint8Array; cut: boolean }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let ended = false;
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), RESPONSE_BODY_WAIT_MS);
  });
  try {
    while (size < limit) {
      const read = reader.read();
      // Left pending when the wait ends first: its failure is nobody's to handle.
      read.catch(() => {});
      const next = await Promise.race([read, late]);
      if (next === "late") break;
      if (next.done) {
        ended = true;
        break;
      }
      chunks.push(next.value);
      size += next.value.length;
    }
  } catch {
    // The time limit of the check ended the read: what was read is shown.
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
  return {
    bytes: Buffer.concat(chunks).subarray(0, limit),
    cut: !ended || size > limit,
  };
}

export async function describeResponse(
  response: Response,
  limit = RESPONSE_BODY_BYTES,
): Promise<ResponseDetail> {
  const headers = [...response.headers].map(([name, value]): [string, string] => [
    printable(name),
    SENSITIVE_HEADER.test(name) ? HIDDEN_VALUE : printable(value),
  ]);
  const detail: ResponseDetail = { statusText: printable(response.statusText), headers };
  if (!response.body) return detail;

  const type = printable(response.headers.get("content-type")?.split(";")[0] ?? "").trim();
  if (type && !TEXT_TYPE.test(type)) {
    void response.body.cancel().catch(() => {});
    return { ...detail, bodyNote: `${type} body, not shown` };
  }
  const { bytes, cut } = await readStart(response.body, limit);
  if (bytes.length === 0) return detail;
  if (bytes.includes(NUL)) return { ...detail, bodyNote: "binary body, not shown" };
  const decoded = new TextDecoder().decode(bytes).replaceAll("\t", "  ");
  // A cut can fall inside a character: its half is dropped.
  const text = printable(cut ? decoded.replace(new RegExp(`${REPLACEMENT}+$`), "") : decoded, "\n");
  const body = text.trimEnd();
  if (!body) return detail;
  return cut ? { ...detail, body, bodyCut: true } : { ...detail, body };
}
