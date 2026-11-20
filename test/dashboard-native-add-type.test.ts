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
const DOWN = `${ESC}[B`;
const RIGHT = `${ESC}[C`;
// http, command, postgres, mysql, redis: the Type row wraps around after the last.
const TYPES = 5;
const SECRET = "s3cr3t-token-0123456789";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const empty = { schemaVersion: 1, services: { api: { port: 3000 } } } as Config;

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
      (name) => ({ name, type: "command", ok: true, target: name, latencyMs: 1 }) as CheckResult,
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

describe("adding a service of any type", () => {
  it("offers every type in a Type row after the name, http first", async () => {
    const { press, draw } = open(empty);

    await press("a");

    expect(draw()).toMatch(/Name\s+api[\s\S]*Type\s+.*http[\s\S]*Address/);
    expect(draw()).not.toContain("Command");
  });

  it("swaps the rows for those of the chosen type and keeps the name", async () => {
    const { press, draw } = open(empty);

    await press(`aweb${DOWN}${RIGHT}`);

    expect(draw()).toContain("Command");
    expect(draw()).toContain("Env");
    expect(draw()).not.toContain("Address");
    expect(draw()).toContain("web");
  });

  it("goes back to the rows of http when http is chosen again", async () => {
    const { press, draw } = open(empty);

    await press(`a${DOWN}${RIGHT.repeat(TYPES)}`);

    expect(draw()).toContain("Address");
    expect(draw()).not.toContain("Command");
  });

  it("adds a command service", async () => {
    const { press, written } = open(empty);

    await press(`adb${DOWN}${RIGHT}${DOWN}redis-cli ping${ENTER}`);

    expect(written()).toMatchObject({
      kind: "add",
      name: "db",
      fields: { type: "command", command: "redis-cli ping" },
    });
  });

  it("keeps an env secret in local.yml and a reference in the config", async () => {
    const { press, draw, kept, screens, written } = open(empty);

    await press(`adb${DOWN}${RIGHT}${DOWN}psql -c "select 1"${DOWN}PGPASSWORD=${SECRET}${ENTER}`);
    expect(draw()).toContain("PGPASSWORD holds a secret");
    await press(ENTER);

    expect(written()).toMatchObject({
      kind: "add",
      name: "db",
      fields: { type: "command", env: { PGPASSWORD: reference("DB_PGPASSWORD") } },
    });
    expect(kept).toEqual([{ DB_PGPASSWORD: SECRET }]);
    expect(JSON.stringify(written())).not.toContain(SECRET);
    expect(screens.join("\n")).not.toContain(SECRET);
  });

  it("adds a postgres service, its password kept in local.yml and a reference in the config", async () => {
    const { press, draw, kept, screens, written } = open(empty);

    await press(`adb${DOWN}${RIGHT}${RIGHT}${DOWN}${DOWN}${DOWN}app${DOWN}wakfuli${DOWN}${SECRET}`);
    expect(screens.at(-1)).not.toContain(SECRET);
    await press(ENTER);
    expect(draw()).toContain("Password holds a secret");
    await press(ENTER);

    expect(written()).toMatchObject({
      kind: "add",
      name: "db",
      fields: { type: "postgres", user: "app", database: "wakfuli" },
    });
    const { password } = written().fields;
    expect(password).toMatch(/^\$\{[A-Z_]+\}$/);
    expect(Object.values(kept[0] ?? {})).toEqual([SECRET]);
    expect(JSON.stringify(written())).not.toContain(SECRET);
    expect(screens.join("\n")).not.toContain(SECRET);
  });

  it("refuses a redis database that is not a number", async () => {
    const { press, draw } = open(empty);

    await press(`adb${DOWN}${RIGHT.repeat(4)}${DOWN}${DOWN}${DOWN}${DOWN}main${ENTER}`);

    expect(draw()).toContain("a database number");
  });

  it("shows no Type row when editing", async () => {
    const { press, draw } = open(empty);

    await press("e");

    expect(draw()).not.toMatch(/Type\s/);
  });
});
