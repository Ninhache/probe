import { describe, expect, it } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import { reference } from "../src/config/headers";
import { detailLines, sparkline } from "../src/dashboard/detail";

const base = { name: "api", type: "http", target: "http://localhost:3000/" };
const up: CheckResult = {
  ...base,
  ok: true,
  status: 200,
  latencyMs: 4,
  response: {
    statusText: "OK",
    headers: [
      ["content-type", "application/json"],
      ["x-request-id", "42"],
    ],
    body: '{"status":"ok"}\n{"more":1}',
  },
};
const options = { unicode: true, width: 40, room: 20 };
const texts = (result: CheckResult, history: number[] = [], overrides = {}) =>
  detailLines(result, history, { ...options, ...overrides }).map(({ text }) => text);

describe("sparkline", () => {
  it("draws one bar per check, the lowest and the highest at both ends of the scale", () => {
    expect(sparkline([1, 5, 9], true, 40)).toBe("▁▅█ 1–9ms");
    expect(sparkline([4, 4], true, 40)).toBe("▁▁ 4ms");
  });

  it("keeps the last checks when the line is too short for all", () => {
    expect(sparkline([1, 2, 3, 4, 9], true, 9)).toBe("▃▄█ 1–9ms");
  });

  it("says the range in words without unicode, and nothing without a check", () => {
    expect(sparkline([1, 5, 9], false, 40)).toBe("1-9ms over 3 checks");
    expect(sparkline([7], false, 40)).toBe("7ms over 1 check");
    expect(sparkline([], true, 40)).toBe("");
  });
});

describe("detailLines", () => {
  it("shows the status, the latencies, the headers and the body", () => {
    expect(texts(up, [3, 4])).toEqual([
      "200 OK · 4ms",
      "▁█ 3–4ms",
      "content-type: application/json",
      "x-request-id: 42",
      '{"status":"ok"}',
      '{"more":1}',
    ]);
  });

  it("shows the diagnosis and its hint, on several lines when it is long", () => {
    const down: CheckResult = {
      ...base,
      ok: false,
      latencyMs: 1,
      error: "connection refused",
      hint: "nothing listens on :3000: is the service started?",
    };

    expect(texts(down, [], { width: 30 })).toEqual([
      "connection refused",
      "nothing listens on :3000: is",
      "the service started?",
    ]);
  });

  it("shows the status and the diagnosis of an answer that is not the expected one", () => {
    const wrong: CheckResult = {
      ...up,
      ok: false,
      status: 500,
      error: "expected 2xx, got 500",
      response: { statusText: "Internal Server Error", headers: [], body: "boom" },
    };

    expect(texts(wrong)).toEqual([
      "500 Internal Server Error · 4ms",
      "expected 2xx, got 500",
      "boom",
    ]);
    expect(detailLines(wrong, [], options)[0]?.tone).toBe("bad");
  });

  it("lists the headers every response carries after the others", () => {
    const response = {
      statusText: "OK",
      headers: [
        ["connection", "keep-alive"],
        ["Date", "today"],
        ["x-request-id", "42"],
      ] as [string, string][],
    };

    expect(texts({ ...up, response })).toEqual([
      "200 OK · 4ms",
      "x-request-id: 42",
      "connection: keep-alive",
      "Date: today",
    ]);
  });

  it("says a skipped service is not checked", () => {
    expect(texts({ ...base, ok: true, skipped: true, latencyMs: 0 }, [4])).toEqual([
      "skipped: not checked",
    ]);
  });

  it("counts the headers and marks the body that do not fit", () => {
    expect(texts(up, [], { room: 3 })).toEqual([
      "200 OK · 4ms",
      "… 2 more headers",
      '{"status":"ok"} …',
    ]);
    expect(texts(up, [], { room: 2 })).toEqual(["200 OK · 4ms", '{"status":"ok"} …']);
    expect(texts(up, [], { room: 0 })).toEqual(["200 OK · 4ms"]);
  });

  it("marks a body cut by the checker and names one that is not text", () => {
    const cut = {
      ...up,
      response: { statusText: "OK", headers: [], body: "aaa", bodyCut: true as const },
    };
    const image = {
      ...up,
      response: { statusText: "OK", headers: [], bodyNote: "image/png body, not shown" },
    };

    expect(texts(cut)).toEqual(["200 OK · 4ms", "aaa …"]);
    expect(texts(image)).toEqual(["200 OK · 4ms", "image/png body, not shown"]);
  });

  it("stays within the width and writes without unicode", () => {
    const lines = texts(up, [3, 4], { unicode: false, width: 12, room: 4 });

    expect(lines.every((line) => line.length <= 12)).toBe(true);
    expect(lines[0]).toBe("200 OK - 4ms");
    expect(lines.join("\n")).not.toMatch(/[·–▁]/);
  });
});

describe("detailLines sent headers", () => {
  it("should say which headers a service that did not answer sends", () => {
    const refused: CheckResult = {
      ...base,
      ok: false,
      latencyMs: 1,
      error: "connection refused",
      sent: ["X-Tenant: acme", `Authorization: Bearer ${reference("API_TOKEN")}`],
    };

    expect(texts(refused, [], { width: 80 })).toEqual([
      "connection refused",
      "Headers sent:",
      "  X-Tenant: acme",
      `  Authorization: Bearer ${reference("API_TOKEN")}`,
    ]);
  });

  it("should count the headers sent that do not fit", () => {
    const sent = ["A: 1", "B: 2", "C: 3", "D: 4", "E: 5"];

    expect(texts({ ...base, ok: false, latencyMs: 1, sent })).toEqual([
      "down",
      "Headers sent:",
      "  A: 1",
      "  B: 2",
      "  C: 3",
      "  … 2 more",
    ]);
  });
});

describe("detailLines request", () => {
  it("should give the method and the whole URL, in pieces when it is long", () => {
    const target = "http://localhost:3000/acme/health?region=new%20york";
    const refused: CheckResult = { ...base, target, ok: false, latencyMs: 1, method: "GET" };

    expect(texts(refused, [], { width: 30 })).toEqual([
      "down",
      "Request:",
      "  GET http://localhost:3000/ac",
      "  me/health?region=new%20york",
    ]);
  });
});
