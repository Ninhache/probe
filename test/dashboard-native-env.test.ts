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
const CTRL_U = "\x15";
const SECRET = "s3cr3t-token-0123456789";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const withEnv = (env?: Record<string, string>): Config =>
  ({
    schemaVersion: 1,
    services: { db: { type: "command", command: ["mysqladmin", "ping"], env } },
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

const DB_PASSWORD = reference("DB_PASSWORD");

describe("the env of a command service", () => {
  it("shows each variable on its line, with one more to add", async () => {
    const { press, draw } = open(withEnv({ MYSQL_HOST: "127.0.0.1" }));

    await press("e");

    expect(draw()).toContain("Env      MYSQL_HOST=127.0.0.1");
    expect(draw().match(/Env /g)).toHaveLength(2);
  });

  it("writes the env as it was when nothing was typed", async () => {
    const env = { MYSQL_HOST: "127.0.0.1", MYSQL_PWD: DB_PASSWORD };
    const { press, written } = open(withEnv(env));

    await press(`e${ENTER}`);

    expect(written()).toMatchObject({ kind: "edit", name: "db", fields: { env } });
  });

  it("adds the variable typed on the last line, a value may hold an equal sign", async () => {
    const { press, written } = open(withEnv());

    await press(`e${DOWN}DATABASE_URL=postgres://db/app?mode=ro${ENTER}`);

    expect(written()).toMatchObject({
      fields: { env: { DATABASE_URL: "postgres://db/app?mode=ro" } },
    });
  });

  it("goes to the line that cannot be saved and says why", async () => {
    const { press, draw, writes } = open(withEnv({ MYSQL_HOST: "db" }));

    await press(`e${DOWN}${DOWN}1BAD=x${TAB}${ENTER}`);

    expect(draw()).toContain("Expects a name of letters, digits and _");
    expect(writes).toEqual([]);
  });
});

describe("the secret of an env variable", () => {
  it("keeps a secret typed in clear off the screen and gives it a variable", async () => {
    const { press, draw, kept, screens, written } = open(withEnv());

    await press(`e${DOWN}MYSQL_PWD=${SECRET}`);
    expect(draw()).not.toContain(SECRET);
    await press(ENTER);
    expect(draw()).toContain("MYSQL_PWD holds a secret");
    expect(draw()).toContain("DB_MYSQL_PWD");
    await press(ENTER);

    expect(draw()).toContain("Saved db, DB_MYSQL_PWD kept in .probe/local.yml");
    expect(written().fields.env).toEqual({ MYSQL_PWD: reference("DB_MYSQL_PWD") });
    expect(kept).toEqual([{ DB_MYSQL_PWD: SECRET }]);
    expect(screens.join("\n")).not.toContain(SECRET);
    expect(screens.join("\n")).not.toContain(SECRET.slice(0, 6));
  });

  it("takes the name typed for the variable", async () => {
    const { press, kept, written } = open(withEnv());

    await press(`e${DOWN}PGPASSWORD=${SECRET}${ENTER}`);
    await press(`${CTRL_U}PG_PASSWORD${ENTER}`);

    expect(written().fields.env).toEqual({ PGPASSWORD: reference("PG_PASSWORD") });
    expect(kept).toEqual([{ PG_PASSWORD: SECRET }]);
  });

  it("shows a reference typed by hand", async () => {
    const { press, draw, screens } = open(withEnv());

    await press(`e${DOWN}MYSQL_PWD=${SECRET}`);
    await press(`${CTRL_U}MYSQL_PWD=${DB_PASSWORD}`);

    expect(draw()).toContain(`MYSQL_PWD=${DB_PASSWORD}`);
    expect(screens.join("\n")).not.toContain(SECRET);
  });

  it("asks for a reference where no variable can be kept", async () => {
    const { press, draw, writes, screens } = open(withEnv(), { variableSources: undefined });

    await press(`e${DOWN}MYSQL_PWD=${SECRET}${ENTER}`);

    expect(draw()).toContain("MYSQL_PWD expects a reference");
    expect(writes).toEqual([]);
    expect(screens.join("\n")).not.toContain(SECRET);
  });
});
