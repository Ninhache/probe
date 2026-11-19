import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import type { ProbePaths } from "../src/config/discovery";
import { hiddenHeaderLine } from "../src/config/headers";
import { Tracker } from "../src/dashboard/native/history";
import {
  handleInput,
  initialView,
  renderDashboard,
  type ViewActions,
} from "../src/dashboard/native/view";
import { HTTP_ONLY, NO_RESPONSE, responseText, traceText } from "../src/dashboard/response";
import { saveTrace, traceStamp } from "../src/dashboard/traces";
import type { InputEvent } from "../src/tui/input";
import { Screen } from "../src/tui/screen";

const SECRET = "s3cr3t-initech-value";
const QUERY_SECRET = "q-s3cr3t-globex-value";

const key = (name: string): InputEvent =>
  ({ kind: "key", name, ctrl: false, alt: false, shift: false, raw: name }) as InputEvent;

const http = (overrides: Partial<CheckResult> = {}): CheckResult => ({
  name: "api",
  type: "http",
  ok: true,
  target: `https://example.com/health?token=${QUERY_SECRET}&page=2`,
  latencyMs: 12,
  status: 200,
  method: "GET",
  sent: [hiddenHeaderLine(`Authorization: Bearer ${SECRET}`, "*"), "Accept: application/json"],
  response: {
    statusText: "OK",
    headers: [
      ["content-type", "application/json"],
      ["set-cookie", "(hidden)"],
    ],
    body: '{"ok":true}',
  },
  ...overrides,
});

const dirs: string[] = [];
async function project(): Promise<ProbePaths> {
  const root = await mkdtemp(join(tmpdir(), "probe-trace-"));
  dirs.push(root);
  const dir = join(root, ".probe");
  return {
    root,
    dir,
    config: join(dir, "config.yml"),
    lock: join(dir, "lock.yml"),
    local: join(dir, "local.yml"),
  };
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const AT = new Date(2026, 10, 19, 12, 4, 33);

describe("the text of a trace", () => {
  it("is the request line and headers, a blank line, then the response the copy takes", () => {
    const result = http();
    const text = traceText(result) ?? "";
    const [request, response] = text.split("\r\n\r\n", 2);

    expect(request?.split("\r\n")[0]).toBe(
      "GET https://example.com/health?token=***&page=2 HTTP/1.1",
    );
    expect(request).toContain("Accept: application/json");
    expect(text.endsWith(responseText(result) ?? "?")).toBe(true);
    expect(response).toContain("HTTP/1.1 200 OK");
  });

  it("never holds a secret header value, a secret query value or a password", () => {
    const text = traceText(
      http({ target: `https://globex:${SECRET}@example.com/x?api_key=${QUERY_SECRET}` }),
    );

    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(QUERY_SECRET);
    expect(text).toContain("Authorization: Bearer ");
  });

  it("is nothing without a response", () => {
    expect(traceText(http({ response: undefined }))).toBeUndefined();
  });
});

describe("saving a trace", () => {
  it("writes .probe/traces/<service>-<local time>.http with the content, and says the path", async () => {
    const paths = await project();
    const text = traceText(http()) ?? "";

    const notice = await saveTrace(paths, "api", text, AT);

    expect(notice).toBe("Saved .probe/traces/api-2026-11-19T12-04-33.http");
    expect(await readFile(join(paths.dir, "traces", "api-2026-11-19T12-04-33.http"), "utf8")).toBe(
      text,
    );
  });

  it("names the file in local time, with no colon", () => {
    expect(traceStamp(new Date(2026, 0, 5, 3, 4, 5))).toBe("2026-01-05T03-04-05");
  });

  it("writes the .gitignore of the folder once and never over a changed one", async () => {
    const paths = await project();
    await saveTrace(paths, "api", "one", AT);
    const ignore = join(paths.dir, "traces", ".gitignore");
    expect(await readFile(ignore, "utf8")).toBe("*\n");

    await writeFile(ignore, "*\n!keep.http\n");
    await saveTrace(paths, "api", "two", new Date(AT.getTime() + 5000));

    expect(await readFile(ignore, "utf8")).toBe("*\n!keep.http\n");
  });

  it("never touches the .gitignore of the project", async () => {
    const paths = await project();
    await saveTrace(paths, "api", "one", AT);

    expect(existsSync(join(paths.root, ".gitignore"))).toBe(false);
  });

  it("adds -2 and -3 when the name is taken, and keeps the first file", async () => {
    const paths = await project();
    await saveTrace(paths, "api", "first", AT);
    const second = await saveTrace(paths, "api", "second", AT);
    const third = await saveTrace(paths, "api", "third", AT);

    expect(second).toBe("Saved .probe/traces/api-2026-11-19T12-04-33-2.http");
    expect(third).toBe("Saved .probe/traces/api-2026-11-19T12-04-33-3.http");
    const folder = join(paths.dir, "traces");
    expect(await readFile(join(folder, "api-2026-11-19T12-04-33.http"), "utf8")).toBe("first");
    expect((await readdir(folder)).sort()).toEqual([
      ".gitignore",
      "api-2026-11-19T12-04-33-2.http",
      "api-2026-11-19T12-04-33-3.http",
      "api-2026-11-19T12-04-33.http",
    ]);
  });

  it("keeps a service name from leaving the folder", async () => {
    const paths = await project();
    const notice = await saveTrace(paths, "../globex", "x", AT);

    expect(notice).toBe("Saved .probe/traces/.._globex-2026-11-19T12-04-33.http");
  });

  it("says it did not save, and why, when the folder cannot be made", async () => {
    const paths = await project();
    await writeFile(join(paths.root, ".probe"), "a file, not a folder");

    expect(await saveTrace(paths, "api", "x", AT)).toMatch(/^Not saved: /);
  });
});

describe("w on the dashboard", () => {
  function setup(result: CheckResult | undefined) {
    const tracker = new Tracker(["local"]);
    if (result) tracker.record("local", [result], 1);
    const view = initialView();
    const saved: [string, string][] = [];
    const actions: ViewActions = {
      quit() {},
      refresh() {},
      saveTrace: (service, text) => saved.push([service, text]),
    };
    const draw = () => {
      const screen = new Screen(110, 30, "truecolor");
      renderDashboard(screen, { x: 0, y: 0, w: 110, h: 30 }, tracker, view, 0);
      return screen.toPlainText();
    };
    const press = (...names: string[]) => {
      for (const name of names) handleInput(key(name), tracker, view, actions);
    };
    draw();
    return { press, draw, saved };
  }

  it("saves on w, from the list, and only then", () => {
    const { press, saved } = setup(http());
    press("down", "up", "2", "1");
    expect(saved).toEqual([]);

    press("w");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.[0]).toBe("api");
    expect(saved[0]?.[1]).toBe(traceText(http()));
  });

  it("saves from the full response view too", () => {
    const { press, saved } = setup(http());
    press("enter", "r", "w");

    expect(saved).toHaveLength(1);
  });

  it("writes nothing and says so when there is no response yet", () => {
    const { press, draw, saved } = setup(http({ response: undefined, status: undefined }));
    press("w");

    expect(saved).toEqual([]);
    expect(draw()).toContain(NO_RESPONSE);
  });

  it("writes nothing for a service that is not checked over HTTP", () => {
    const { press, draw, saved } = setup({
      name: "db",
      type: "tcp",
      ok: true,
      target: "example.com:5432",
      latencyMs: 1,
    });
    press("w");

    expect(saved).toEqual([]);
    expect(draw()).toContain(HTTP_ONLY);
  });

  it("is in the palette", () => {
    const { press, draw } = setup(http());
    press(":");
    for (const c of "save") press(c);

    expect(draw()).toContain("Save the response to .probe/traces");
  });

  it("never shows the content in the notice or on screen", async () => {
    const paths = await project();
    const tracker = new Tracker(["local"]);
    tracker.record("local", [http()], 1);
    const view = initialView();
    let notice = "";
    const actions: ViewActions = {
      quit() {},
      refresh() {},
      saveTrace: (service, text) =>
        void saveTrace(paths, service, text, AT).then((m) => (notice = m)),
    };
    handleInput(key("w"), tracker, view, actions);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const file = await readFile(join(paths.dir, "traces", "api-2026-11-19T12-04-33.http"), "utf8");
    for (const secret of [SECRET, QUERY_SECRET]) {
      expect(file).not.toContain(secret);
      expect(notice).not.toContain(secret);
    }
    expect(notice).toBe("Saved .probe/traces/api-2026-11-19T12-04-33.http");
  });
});
