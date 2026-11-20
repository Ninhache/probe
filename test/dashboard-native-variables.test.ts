import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CheckResult } from "../src/checkers/types";
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
import type { DashboardSettings } from "../src/dashboard/settings";
import { variableTools } from "../src/dashboard/variables";
import { dashboardWrites } from "../src/dashboard/writes";
import { parseInput } from "../src/tui/input";
import { Screen } from "../src/tui/screen";
import { tempProject } from "./helpers";

const ESC = "\x1b";
const ENTER = "\r";
const DOWN = `${ESC}[B`;
const SECRET = "panel-secret-value";

const localConfig = {
  schemaVersion: 1,
  services: {
    api: {
      url: "https://api.example.com",
      headers: { "X-Key": reference("API_KEY"), "X-Team": reference("TEAM") },
    },
    db: { url: "https://db.example.com", headers: { "X-Key": reference("API_KEY") } },
  },
} as unknown as Config;
const prodConfig = {
  schemaVersion: 1,
  services: {
    globex: {
      url: "https://globex.example.com",
      headers: { Authorization: `Bearer ${reference("GLOBEX_TOKEN")}` },
    },
  },
} as unknown as Config;

const answered = (name: string): CheckResult =>
  ({ name, type: "http", ok: true, target: `http://${name}`, latencyMs: 5 }) as CheckResult;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

type Where = Record<string, Record<string, "local" | "environment">>;

function open(where: Where, edits: Partial<EditCallbacks> = {}) {
  const looked: Array<string | undefined> = [];
  const editing = liveEditing(localConfig, {
    variableSources: async (names, env) => {
      looked.push(env);
      const here = where[env ?? "local"] ?? {};
      return Object.fromEntries(names.map((name) => [name, here[name]]));
    },
    onVariableWrite: async () => undefined,
    onVariableRemove: async () => undefined,
    ...edits,
  });
  editing.observe?.("prod", prodConfig);
  const view = initialView({});
  const tracker = new Tracker(["local", "prod"]);
  tracker.record("local", Object.keys(localConfig.services).map(answered), 1);
  tracker.record("prod", [answered("globex")], 1);
  const changed = vi.fn();
  const edit = createEditor({
    view,
    tracker,
    editing,
    changed,
    redraw: () => {},
    declaredIn: () => [],
  });
  const actions: ViewActions = { quit: vi.fn(), refresh: () => {}, edit };
  const draw = () => {
    const screen = new Screen(110, 32, "truecolor");
    renderDashboard(screen, { x: 0, y: 0, w: 110, h: 32 }, tracker, view, 0);
    return screen.toPlainText();
  };
  const press = (text: string) => {
    for (const event of parseInput(text)) handleInput(event, tracker, view, actions);
  };
  draw();
  return { view, tracker, draw, press, changed, looked, quit: actions.quit };
}

/** Opens the panel on the tab whose index is `tab` and waits for its rows. */
async function panel(tab: number, where: Where, edits: Partial<EditCallbacks> = {}) {
  const made = open(where, edits);
  made.view.tab = tab;
  made.press("v");
  await tick();
  return made;
}

describe("the variables panel", () => {
  it("should list each variable the services send once, with where it is set", async () => {
    const { draw } = await panel(1, { local: { API_KEY: "local" } });

    const frame = draw();
    expect(frame).toContain("variables · local");
    expect(frame).toMatch(/API_KEY\s+set in local\.yml/);
    expect(frame).toMatch(/TEAM\s+not set/);
    expect(frame.match(/API_KEY/g)).toHaveLength(1);
  });

  it("should say a variable is set in the environment", async () => {
    const { draw } = await panel(1, { local: { TEAM: "environment" } });

    expect(draw()).toMatch(/TEAM\s+set in the environment/);
  });

  it("should list those of the environment on its tab, read in its own scope", async () => {
    const { draw, looked } = await panel(2, { prod: { GLOBEX_TOKEN: "local" } });

    const frame = draw();
    expect(frame).toContain("variables · prod");
    expect(frame).toMatch(/GLOBEX_TOKEN\s+set in local\.yml/);
    expect(frame).not.toContain("API_KEY");
    expect(looked).toContain("prod");
  });

  it("should open on the environment of the selected service on the all tab", async () => {
    const { draw, press } = open({ prod: { GLOBEX_TOKEN: "local" } });
    press("jj");
    press("v");
    await tick();

    expect(draw()).toContain("variables · prod");
  });

  it("should say so when no header sends a variable", async () => {
    const made = open({});
    made.view.tab = 1;
    made.tracker.record("local", [], 2);
    const bare = liveEditing({ schemaVersion: 1, services: {} } as Config, {
      variableSources: async () => ({}),
    });
    const edit = createEditor({
      view: made.view,
      tracker: made.tracker,
      editing: bare,
      changed: () => {},
      redraw: () => {},
      declaredIn: () => [],
    });
    handleInput(parseInput("v")[0] as never, made.tracker, made.view, {
      quit: () => {},
      refresh: () => {},
      edit,
    });
    await tick();

    expect(made.draw()).toContain("No header or env of local uses a variable");
  });

  it("should close on v and on esc, and offer the keys in the bar", async () => {
    const { press, view, draw } = await panel(1, {});

    expect(draw()).toContain("↵ set");
    press("v");
    expect(view.modals.depth).toBe(0);
    press("v");
    press(ESC);
    expect(view.modals.depth).toBe(0);
  });

  it("should be in the command palette", () => {
    const { press, draw } = open({});
    press(":variables");

    expect(draw()).toContain("variables");
  });

  describe("setting a value", () => {
    it("should take it hidden and write it under this environment only", async () => {
      const onVariableWrite = vi.fn(async () => undefined);
      const { press, draw } = await panel(2, {}, { onVariableWrite });

      press(`${ENTER}${SECRET}`);
      expect(draw()).not.toContain(SECRET);
      press(ENTER);
      await tick();

      expect(onVariableWrite).toHaveBeenCalledWith("GLOBEX_TOKEN", SECRET, "prod");
      const frame = draw();
      expect(frame).toContain("Kept GLOBEX_TOKEN in .probe/local.yml, under envs.prod");
      expect(frame).not.toContain(SECRET);
    });

    it("should write the top level for local", async () => {
      const onVariableWrite = vi.fn(async () => undefined);
      const { press } = await panel(1, {}, { onVariableWrite });

      press(`${DOWN}${ENTER}${SECRET}${ENTER}`);
      await tick();

      expect(onVariableWrite).toHaveBeenCalledWith("TEAM", SECRET);
    });

    it("should not change a variable of the process environment", async () => {
      const onVariableWrite = vi.fn(async () => undefined);
      const { press, draw } = await panel(
        1,
        { local: { API_KEY: "environment" } },
        { onVariableWrite },
      );

      press(ENTER);

      expect(onVariableWrite).not.toHaveBeenCalled();
      expect(draw()).toContain("API_KEY comes from the environment");
    });

    it("should keep the row and say why when the value cannot be saved", async () => {
      const { press, draw } = await panel(
        1,
        {},
        { onVariableWrite: async () => ".probe/local.yml is broken" },
      );

      press(`${ENTER}${SECRET}${ENTER}`);
      await tick();

      const frame = draw();
      expect(frame).toContain("not saved: .probe/local.yml is broken");
      expect(frame).not.toContain(SECRET);
    });

    it("should read the rows again once a value is kept", async () => {
      const where: Where = { local: {} };
      const { press, draw } = await panel(1, where, {
        onVariableWrite: async (name) => {
          (where.local as Record<string, "local">)[name] = "local";
          return undefined;
        },
      });

      press(`${ENTER}${SECRET}${ENTER}`);
      await tick();
      await tick();

      expect(draw()).toMatch(/API_KEY\s+set in local\.yml/);
    });

    it("should type q into the value instead of quitting", async () => {
      const { press, quit } = await panel(1, {});

      press(`${ENTER}qq`);

      expect(quit).not.toHaveBeenCalled();
    });
  });

  describe("removing a value", () => {
    it("should ask, then remove it from this environment's scope", async () => {
      const onVariableRemove = vi.fn(async () => undefined);
      const { press, draw, changed } = await panel(
        2,
        { prod: { GLOBEX_TOKEN: "local" } },
        { onVariableRemove },
      );

      press("d");
      expect(draw()).toContain(
        "Remove the value of GLOBEX_TOKEN from .probe/local.yml, under envs.prod?",
      );
      expect(onVariableRemove).not.toHaveBeenCalled();
      press("y");
      await tick();

      expect(onVariableRemove).toHaveBeenCalledWith("GLOBEX_TOKEN", "prod");
      expect(draw()).toContain("Removed GLOBEX_TOKEN from .probe/local.yml, under envs.prod");
      expect(changed).toHaveBeenCalled();
    });

    it("should keep the value when the question is answered no", async () => {
      const onVariableRemove = vi.fn(async () => undefined);
      const { press } = await panel(1, { local: { API_KEY: "local" } }, { onVariableRemove });

      press("d");
      press("n");
      await tick();

      expect(onVariableRemove).not.toHaveBeenCalled();
    });

    it("should say a variable of the process environment is unset there", async () => {
      const onVariableRemove = vi.fn(async () => undefined);
      const { press, draw } = await panel(
        1,
        { local: { API_KEY: "environment" } },
        { onVariableRemove },
      );

      press("d");

      expect(draw()).toContain("API_KEY comes from the environment: unset it there");
      expect(onVariableRemove).not.toHaveBeenCalled();
    });

    it("should say a variable with no value has nothing to remove", async () => {
      const onVariableRemove = vi.fn(async () => undefined);
      const { press, draw } = await panel(1, {}, { onVariableRemove });

      press("d");

      expect(draw()).toContain("API_KEY has no value in .probe/local.yml");
      expect(onVariableRemove).not.toHaveBeenCalled();
    });

    it("should say why when the file cannot be written", async () => {
      const { press, draw } = await panel(
        1,
        { local: { API_KEY: "local" } },
        { onVariableRemove: async () => ".probe/local.yml cannot be written (EACCES)" },
      );

      press("dy");
      await tick();

      expect(draw()).toContain("not saved: .probe/local.yml cannot be written (EACCES)");
    });
  });
});

describe("the variables of every service", () => {
  it("should list a name once, in the order the headers send them", async () => {
    const tools = variableTools(
      () => localConfig,
      async () => ({}),
    );

    expect((await tools.allVariables()).map(({ name }) => name)).toEqual(["API_KEY", "TEAM"]);
  });

  it("should list none for a config with no header", async () => {
    const tools = variableTools(
      () => ({ schemaVersion: 1, services: {} }) as Config,
      async () => ({}),
    );

    expect(await tools.allVariables()).toEqual([]);
  });
});

describe("removing a value from local.yml", () => {
  const SETTINGS = { intervalMs: 2000, timeoutMs: 3000 } as DashboardSettings;
  const LOCAL = [
    "variables:",
    "  API_KEY: top-level-value",
    "envs:",
    "  prod:",
    "    variables:",
    "      API_KEY: prod-value",
    "      OTHER: other-value",
    "  staging:",
    "    variables:",
    "      API_KEY: staging-value",
    "",
  ].join("\n");

  async function project() {
    const paths = await tempProject("schemaVersion: 1\nservices:\n  api: { port: 3000 }\n");
    await mkdirp(paths.dir);
    await writeFile(join(paths.dir, "envs", "prod.yml"), "schemaVersion: 1\nservices: {}\n");
    await writeFile(join(paths.dir, "envs", "staging.yml"), "schemaVersion: 1\nservices: {}\n");
    await writeFile(join(paths.dir, "local.yml"), LOCAL);
    return paths;
  }
  const mkdirp = async (dir: string) => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "envs"), { recursive: true });
  };

  it("should drop the value of one environment and leave every other value in place", async () => {
    const paths = await project();
    const { writes } = dashboardWrites(paths, SETTINGS);

    const failure = await writes.onVariableRemove("API_KEY", "prod");

    const text = await readFile(join(paths.dir, "local.yml"), "utf8");
    expect(failure).toBeUndefined();
    expect(text).not.toContain("prod-value");
    expect(text).toContain("OTHER: other-value");
    expect(text).toContain("top-level-value");
    expect(text).toContain("staging-value");
  });

  it("should drop the top-level value for local without touching an environment's", async () => {
    const paths = await project();
    const { writes } = dashboardWrites(paths, SETTINGS);

    await writes.onVariableRemove("API_KEY");

    const text = await readFile(join(paths.dir, "local.yml"), "utf8");
    expect(text).not.toContain("top-level-value");
    expect(text).toContain("prod-value");
    expect(text).toContain("staging-value");
  });

  it("should fail without writing for an environment that has no file", async () => {
    const paths = await project();
    const { writes } = dashboardWrites(paths, SETTINGS);

    const failure = await writes.onVariableRemove("API_KEY", "nowhere");

    expect(failure).toBeDefined();
    expect(await readFile(join(paths.dir, "local.yml"), "utf8")).toBe(LOCAL);
  });
});
