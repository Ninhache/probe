import { describe, expect, it } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import type { ServiceWrite } from "../src/commands/service-writes";
import { reference } from "../src/config/headers";
import type { Config } from "../src/config/schema";
import { type EditCallbacks, liveEditing } from "../src/dashboard/editing";
import { createEditor } from "../src/dashboard/native/editor";
import { Tracker } from "../src/dashboard/native/history";
import {
  handleInput,
  initialView,
  renderDashboard,
  type ViewActions,
} from "../src/dashboard/native/view";
import { parseInput } from "../src/tui/input";
import { Screen } from "../src/tui/screen";

const ESC = "\x1b";
const ENTER = "\r";
const TAB = "\t";
const DOWN = `${ESC}[B`;
const UP = `${ESC}[A`;
const CTRL_U = "\x15";
const SECRET = "s3cr3t-token-0123456789";
const ACCEPT = "Accept: text/plain";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const withHeaders = (headers?: Record<string, string>): Config =>
  ({
    schemaVersion: 1,
    services: { api: { host: "localhost", port: 3000, path: "/health", headers } },
  }) as Config;

function open(config: Config, edits: Partial<EditCallbacks> = {}) {
  const writes: ServiceWrite[] = [];
  const kept: Record<string, string>[] = [];
  const screens: string[] = [];
  const editing = liveEditing(config, {
    variableSources: async () => ({}),
    onServiceWrite: async (write, secrets) => {
      writes.push(write);
      if (secrets) kept.push({ ...secrets });
      return { config };
    },
    ...edits,
  });
  const view = initialView({ choices: {} });
  const tracker = new Tracker(["local"]);
  tracker.record(
    "local",
    Object.keys(config.services).map(
      (name) => ({ name, type: "http", ok: true, target: name, latencyMs: 1 }) as CheckResult,
    ),
    1,
  );
  const edit = createEditor({
    view,
    tracker,
    editing,
    changed: () => {},
    redraw: () => {},
    declaredIn: () => [],
  });
  const actions: ViewActions = { quit() {}, refresh() {}, edit };
  const draw = () => {
    const screen = new Screen(110, 32, "truecolor");
    renderDashboard(screen, { x: 0, y: 0, w: 110, h: 32 }, tracker, view, 0);
    const frame = screen.toPlainText();
    screens.push(frame);
    return frame;
  };
  const press = async (text: string) => {
    for (const event of parseInput(text)) handleInput(event, tracker, view, actions);
    await tick();
    draw();
  };
  draw();
  const written = () => writes.at(-1) as Extract<ServiceWrite, { kind: "edit" | "add" }>;
  return { press, draw, writes, kept, screens, written };
}

describe("the headers of a service", () => {
  it("shows each header on its line, with one more to add", async () => {
    const { press, draw } = open(withHeaders({ Accept: "text/plain" }));

    await press("e");

    expect(draw()).toContain("Header   Accept: text/plain");
    expect(draw()).toContain("Header   Accept: application/json");
  });

  it("writes the headers as they were when nothing was typed", async () => {
    const headers = { Authorization: `Bearer ${reference("API_TOKEN")}`, Accept: "text/plain" };
    const { press, written } = open(withHeaders(headers));

    await press(`e${ENTER}`);

    expect(written()).toMatchObject({ kind: "edit", name: "api", fields: { headers } });
  });

  it("adds the header typed on the last line", async () => {
    const { press, draw, written } = open(withHeaders());

    await press(`e${DOWN.repeat(3)}${ACCEPT}`);
    expect(draw()).toContain("Header   Accept: text/plain");
    await press(ENTER);

    expect(written()).toMatchObject({ fields: { headers: { Accept: "text/plain" } } });
  });

  it("removes the header emptied with ctrl+u", async () => {
    const { press, written } = open(withHeaders({ Accept: "text/plain", "X-Mode": "dev" }));

    await press(`e${DOWN.repeat(3)}${CTRL_U}${ENTER}`);

    expect(written()).toMatchObject({ fields: { headers: { "X-Mode": "dev" } } });
  });

  it("goes to the header that cannot be saved and says why", async () => {
    const { press, draw, writes } = open(withHeaders({ Accept: "text/plain" }));

    await press(`e${DOWN.repeat(4)}accept: text/html${TAB}${ENTER}`);

    expect(draw()).toContain("accept is given twice");
    expect(writes).toEqual([]);
  });
});

describe("the secret of a header", () => {
  it("keeps a secret typed in clear off the screen and gives it a variable", async () => {
    const { press, draw, kept, screens, written } = open(withHeaders());

    await press(`e${DOWN.repeat(3)}Authorization: Bearer ${SECRET}`);
    await press(ENTER);
    expect(draw()).toContain("Authorization holds a secret");
    expect(draw()).toContain("API_TOKEN");
    await press(ENTER);

    expect(draw()).toContain("Saved api, API_TOKEN kept in .probe/local.yml");
    expect(written().fields.headers).toEqual({
      Authorization: `Bearer ${reference("API_TOKEN")}`,
    });
    expect(kept).toEqual([{ API_TOKEN: SECRET }]);
    expect(screens.join("\n")).not.toContain(SECRET);
    expect(screens.join("\n")).not.toContain(SECRET.slice(0, 6));
  });

  it("shows a reference typed by hand", async () => {
    const { press, draw, screens } = open(withHeaders());

    await press(`e${DOWN.repeat(3)}X-Api-Key: ${SECRET}`);
    await press(`${CTRL_U}X-Api-Key: ${reference("KEY")}`);

    expect(draw()).toContain(`X-Api-Key: ${reference("KEY")}`);
    expect(screens.join("\n")).not.toContain(SECRET);
  });

  it("takes the name typed for the variable", async () => {
    const { press, writes, kept, written } = open(withHeaders());

    await press(`e${DOWN.repeat(3)}X-Api-Key: ${SECRET}${ENTER}`);
    await press(`${CTRL_U}MY_KEY${ENTER}`);

    expect(writes).toHaveLength(1);
    expect(written().fields.headers).toEqual({ "X-Api-Key": reference("MY_KEY") });
    expect(kept).toEqual([{ MY_KEY: SECRET }]);
  });

  it("refuses a name the variables cannot hold, and writes nothing", async () => {
    const { press, draw, writes } = open(withHeaders());

    await press(`e${DOWN.repeat(3)}X-Api-Key: ${SECRET}${ENTER}`);
    await press(`${CTRL_U}1BAD${ENTER}`);

    expect(draw()).toContain("Variable");
    expect(draw()).toContain("holds a secret");
    expect(writes).toEqual([]);
  });

  it("asks a name for each secret, never the same twice", async () => {
    const { press, draw, writes, kept, written } = open(withHeaders());

    await press(
      `e${DOWN.repeat(3)}Authorization: Basic ${SECRET}${DOWN}Cookie: sid=${SECRET}${ENTER}`,
    );
    expect(draw()).toContain("Authorization holds a secret");
    await press(ENTER);
    expect(draw()).toContain("Cookie holds a secret");
    expect(draw()).toMatch(/Variable\s+\S+/);
    await press(`${CTRL_U}API_TOKEN${ENTER}`);
    expect(draw()).toContain("API_TOKEN already keeps another secret");
    expect(writes).toEqual([]);
    await press(`${CTRL_U}SID${ENTER}`);

    expect(written().fields.headers).toEqual({
      Authorization: `Basic ${reference("API_TOKEN")}`,
      Cookie: reference("SID"),
    });
    expect(kept).toEqual([{ API_TOKEN: SECRET, SID: `sid=${SECRET}` }]);
  });

  it("keeps the secret of a service that is added", async () => {
    const { press, draw, screens, kept, written } = open(withHeaders());

    await press(`aweb${TAB}${TAB}8080`);
    for (let i = 0; i < 20 && !draw().match(/› Header/); i += 1) await press(TAB);
    await press(`X-Api-Key: ${SECRET}${ENTER}`);
    expect(draw()).toContain("Variable");
    await press(ENTER);

    expect(draw()).toContain("Added web, WEB_API_KEY kept in .probe/local.yml");
    expect(written()).toMatchObject({ kind: "add", name: "web" });
    expect(kept).toEqual([{ WEB_API_KEY: SECRET }]);
    expect(screens.join("\n")).not.toContain(SECRET);
  });

  it("refuses for a secret the variable another header of the service sends", async () => {
    const { press, draw, writes } = open(withHeaders({ "X-Token": reference("API_TOKEN") }));

    await press(`e${DOWN.repeat(4)}Authorization: Bearer ${SECRET}${ENTER}`);
    expect(draw()).toMatch(/Variable\s+API_TOKEN_2/);
    await press(`${CTRL_U}API_TOKEN${ENTER}`);

    expect(draw()).toContain("API_TOKEN already keeps another secret");
    expect(writes).toEqual([]);
  });

  it("keeps no secret whose header was removed after it got its name", async () => {
    const { press, draw, kept, written } = open(withHeaders());

    await press(`e${DOWN.repeat(3)}X-Token: ${SECRET}${DOWN}Cookie: sid=${SECRET}${ENTER}`);
    await press(ENTER);
    expect(draw()).toContain("Cookie holds a secret");
    await press(ESC);
    await press(`${CTRL_U}${UP}${CTRL_U}${ACCEPT}${ENTER}`);

    expect(draw()).not.toContain("kept in");
    expect(kept).toEqual([]);
    expect(written().fields.headers).toEqual({ Accept: "text/plain" });
  });

  it("does not say a secret is kept when keeping it failed", async () => {
    const { press, draw } = open(withHeaders(), {
      onServiceWrite: async () => ({
        config: withHeaders(),
        failure: ".probe/local.yml is broken",
      }),
    });

    await press(`e${DOWN.repeat(3)}X-Token: ${SECRET}${ENTER}`);
    await press(ENTER);

    expect(draw()).toContain("not saved: .probe/local.yml is broken");
    expect(draw()).not.toContain("kept in");
  });

  it("asks for a reference where no variable can be kept", async () => {
    const { press, draw, writes, screens } = open(withHeaders(), { variableSources: undefined });

    await press(`e${DOWN.repeat(3)}X-Token: ${SECRET}${ENTER}`);

    expect(draw()).toContain("X-Token expects a reference");
    expect(writes).toEqual([]);
    expect(screens.join("\n")).not.toContain(SECRET);
  });
});
