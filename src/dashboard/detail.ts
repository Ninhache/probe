import type { CheckResult } from "../checkers/types";
import { DASHBOARD_HISTORY_LENGTH } from "../constants";
import { truncate } from "../ui/terminal";

export type LatencyHistory = Readonly<Record<string, readonly number[]>>;

export interface DetailLine {
  id: string;
  text: string;
  tone?: "good" | "bad" | "dim";
}

const BLOCKS = "▁▂▃▄▅▆▇█";
const HEADER_LINES = 6;
const BODY_LINES = 5;
const HINT_LINES = 3;
// What every response carries: listed after the headers that tell something about the service.
const TRANSPORT_HEADERS = new Set([
  "connection",
  "content-length",
  "date",
  "keep-alive",
  "transfer-encoding",
]);

export function recordLatencies(history: LatencyHistory, results: CheckResult[]): LatencyHistory {
  return Object.fromEntries(
    results.map(({ name, status, skipped, latencyMs }) => {
      const before = history[name] ?? [];
      const answered = status !== undefined && !skipped;
      return [name, answered ? [...before, latencyMs].slice(-DASHBOARD_HISTORY_LENGTH) : before];
    }),
  );
}

export function sparkline(values: readonly number[], unicode: boolean, width: number): string {
  if (values.length === 0) return "";
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = low === high ? `${low}ms` : `${low}${unicode ? "–" : "-"}${high}ms`;
  if (!unicode) return `${range} over ${values.length} ${values.length === 1 ? "check" : "checks"}`;
  const room = width - range.length - 1;
  if (room < 1) return range;
  const top = BLOCKS.length - 1;
  const bars = values
    .slice(-room)
    .map((value) => BLOCKS[high === low ? 0 : Math.round(((value - low) / (high - low)) * top)])
    .join("");
  return `${bars} ${range}`;
}

function wrap(text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  lines.push(line);
  const kept = lines.slice(0, maxLines).map((kept) => truncate(kept, width));
  if (lines.length > maxLines) kept[maxLines - 1] = truncate(`${kept[maxLines - 1]} …`, width);
  return kept;
}

export function detailLines(
  result: CheckResult,
  history: readonly number[],
  { unicode, width, room }: { unicode: boolean; width: number; room: number },
): DetailLine[] {
  const dot = unicode ? "·" : "-";
  const more = unicode ? "…" : "...";
  const cut = (text: string) => truncate(text, width);
  if (result.skipped) return [{ id: "status", text: cut("skipped: not checked"), tone: "dim" }];

  const { response, status } = result;
  const tone = result.ok ? "good" : "bad";
  const lines: DetailLine[] = [];
  if (status === undefined) lines.push({ id: "status", text: cut(result.error ?? "down"), tone });
  else {
    const answer = `${status} ${response?.statusText ?? ""}`.trim();
    lines.push({ id: "status", text: cut(`${answer} ${dot} ${result.latencyMs}ms`), tone });
    if (result.error) lines.push({ id: "error", text: cut(result.error), tone });
  }
  if (result.hint) {
    for (const [index, text] of wrap(result.hint, width, HINT_LINES).entries())
      lines.push({ id: `hint ${index}`, text, tone: "dim" });
  }
  const latencies = sparkline(history, unicode, width);
  if (latencies) lines.push({ id: "latencies", text: cut(latencies), tone: "dim" });
  if (!response) return lines;

  const transport = ([name]: [string, string]) => TRANSPORT_HEADERS.has(name.toLowerCase());
  const headers = [
    ...response.headers.filter((header) => !transport(header)),
    ...response.headers.filter(transport),
  ].map(([name, value]) => `${name}: ${value}`);
  const body = response.bodyNote ? [response.bodyNote] : (response.body?.split("\n") ?? []);
  let headerRoom = Math.min(headers.length, HEADER_LINES);
  let bodyRoom = Math.min(body.length, BODY_LINES);
  // The body gives up lines first, down to one; then the headers.
  const left = Math.max(0, room - lines.length);
  while (headerRoom + bodyRoom > left) {
    if (bodyRoom > 1 && bodyRoom >= headerRoom) bodyRoom -= 1;
    else if (headerRoom > 0) headerRoom -= 1;
    else bodyRoom -= 1;
  }
  const hiddenHeaders = headers.length - headerRoom;
  for (const [index, header] of headers.slice(0, headerRoom).entries()) {
    const last = index === headerRoom - 1 && hiddenHeaders > 0;
    lines.push(
      last
        ? {
            id: `header ${index}`,
            text: cut(`${more} ${hiddenHeaders + 1} more headers`),
            tone: "dim",
          }
        : { id: `header ${index}`, text: cut(header), tone: "dim" },
    );
  }
  const cutBody = body.length > bodyRoom || response.bodyCut;
  for (const [index, text] of body.slice(0, bodyRoom).entries()) {
    const last = index === bodyRoom - 1 && cutBody;
    lines.push({
      id: `body ${index}`,
      text: last
        ? `${truncate(text, Math.max(1, width - more.length - 1))} ${more}`.trim()
        : cut(text),
      tone: response.bodyNote ? "dim" : undefined,
    });
  }
  return lines;
}
