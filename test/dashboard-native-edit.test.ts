import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import {
  createEnvironment,
  EMPTY_ENVIRONMENT,
  type EnvironmentOrigin,
} from "../src/commands/env-create";
import type { ParameterWrite } from "../src/commands/parameter-writes";
import type { ServiceWrite } from "../src/commands/service-writes";
import { reference } from "../src/config/headers";
import { loadConfig } from "../src/config/loader";
import { parameterChoices } from "../src/config/parameters";
import type { Config } from "../src/config/schema";
import type { ParameterWriteOutcome } from "../src/dashboard/editing";
import { type EditCallbacks, liveEditing, timeoutsOf } from "../src/dashboard/editing";
import { createEditor } from "../src/dashboard/native/editor";
import { Tracker } from "../src/dashboard/native/history";
import { Monitor } from "../src/dashboard/native/monitor";
import {
  handleInput,
  initialView,
  renderDashboard,
  type ViewActions,
} from "../src/dashboard/native/view";
import { parseInput } from "../src/tui/input";
import { Screen } from "../src/tui/screen";
import { tempProject } from "./helpers";

const ESC = "\x1b";
const ENTER = "\r";
const TAB = "\t";

const initial: Config = {
  schemaVersion: 1,
  services: {
    api: { host: "localhost", port: 3000, path: "/health" },
    db: { host: "localhost", port: 5432, path: "/" },
  },
} as Config;

const answered = (name: string): CheckResult =>
  ({ name, type: "http", ok: true, target: `http://${name}`, latencyMs: 5 }) as CheckResult;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

interface Options {
  create?: (name: string, from: EnvironmentOrigin) => Promise<string>;
  remove?: (name: string) => Promise<string | undefined>;
  edits?: Partial<EditCallbacks>;
  config?: Config;
  environments?: string[];
}

function setup({ edits = {}, config = initial, environments = [], create, remove }: Options = {}) {
  const writes: ServiceWrite[] = [];
  const kept: Record<string, string>[] = [];
  const callbacks: EditCallbacks = {
    onServiceWrite: async (write, secrets) => {
      writes.push(write);
      if (secrets) kept.push({ ...secrets });
      const services = { ...editing.config().services };
      if (write.kind === "remove") delete services[write.name];
      else services[write.name] = { ...services[write.name], ...write.fields } as never;
      return { config: { ...editing.config(), services } };
    },
    ...edits,
  };
  const editing = liveEditing(config, callbacks);
  const view = initialView({
    choices: parameterChoices(config),
    timeouts: timeoutsOf(config),
  });
  const tracker = new Tracker(["local", ...environments]);
  tracker.record("local", Object.keys(config.services).map(answered), 1);
  const changed = vi.fn();
  const edit = createEditor({
    view,
    tracker,
    editing,
    changed: (restart) => {
      tracker.retain("local", new Set(Object.keys(editing.config().services)));
      if (restart) view.choices = parameterChoices(editing.config());
      changed(restart);
    },
    redraw: () => {},
    declaredIn: () => ["prod.yml"],
    removeEnvironment: remove,
    createEnvironment:
      create &&
      (async (name, from) => {
        const told = await create(name, from);
        tracker.add(name);
        view.tab = tracker.environments.indexOf(name) + 1;
        return told;
      }),
  });
  const calls: string[] = [];
  const actions: ViewActions = { quit: () => calls.push("quit"), refresh: () => {}, edit };
  const draw = (w = 110, h = 32) => {
    const screen = new Screen(w, h, "truecolor");
    renderDashboard(screen, { x: 0, y: 0, w, h }, tracker, view, 0);
    return screen.toPlainText();
  };
  const press = (text: string) => {
    for (const event of parseInput(text)) handleInput(event, tracker, view, actions);
  };
  draw();
  return { view, tracker, editing, writes, kept, calls, draw, press, changed };
}

const footer = (frame: string) => frame.split("\n").at(-1) ?? "";

describe("a service local.yml adds", () => {
  it.each(["e", "d"])("is not changed by %s, which says where it is", (key) => {
    const { press, draw, tracker, view, writes } = setup({
      config: { schemaVersion: 1, services: {} },
    });
    tracker.record("local", [answered("scratch")], 1);
    draw();

    press(key);

    expect(view.modals.depth).toBe(0);
    expect(writes).toEqual([]);
    expect(draw()).toContain("scratch is in .probe/local.yml, under extraServices");
  });
});

describe("removing a service", () => {
  it("asks before removing the selected service", () => {
    const { press, draw, writes } = setup();
    press("d");
    const frame = draw();
    expect(frame).toContain("Remove api from the config?");
    expect(footer(frame)).toContain("y");
    expect(writes).toEqual([]);
  });

  it.each(["n", ESC, "q", ENTER])("keeps the service when the answer is %j", (answer) => {
    const { press, draw, writes, calls, view } = setup();
    press("d");
    press(answer);
    expect(view.modals.depth).toBe(0);
    expect(writes).toEqual([]);
    expect(calls).toEqual([]);
    expect(draw()).toContain("api");
  });

  it("removes the service on y and says so", async () => {
    const { press, draw, writes, tracker, changed } = setup();
    press("jdy");
    await tick();
    expect(writes).toEqual([{ kind: "remove", name: "db" }]);
    expect(draw()).toContain("Removed db");
    expect(tracker.services()).toEqual(["api"]);
    expect(changed).toHaveBeenCalled();
  });

  it("forgets the timeout of the removed service", async () => {
    const config = {
      ...initial,
      services: { ...initial.services, db: { ...initial.services.db, timeout: 4 } },
    } as Config;
    const { press, view } = setup({ config });
    press("jdy");
    await tick();
    expect(view.timeouts.db).toBeUndefined();
  });

  it("keeps the service and says why when the removal is not saved", async () => {
    const { press, draw, tracker } = setup({
      edits: { onServiceWrite: async () => ({ failure: "config.yml is read-only" }) },
    });
    press("dy");
    await tick();
    expect(draw()).toContain("not saved: config.yml is read-only");
    expect(tracker.services()).toEqual(["api", "db"]);
  });
});

describe("adding and editing a service", () => {
  it("opens an empty form on a", () => {
    const { press, draw } = setup();
    press("a");
    const frame = draw();
    expect(frame).toContain("add a service");
    expect(frame).toMatch(/› Name\s+api/);
    expect(frame).toMatch(/Address\s+localhost:3000\/health/);
    expect(frame).toMatch(/Header\s+Accept: application\/json/);
  });

  it("types in the form: q and z are letters there", () => {
    const { press, draw, calls } = setup();
    press("aqz");
    expect(calls).toEqual([]);
    expect(draw()).toContain("qz");
  });

  it("adds the service typed in the form, defaults for what is left empty", async () => {
    const { press, draw, writes, tracker } = setup();
    press(`aweb${TAB}${TAB}8080${ENTER}`);
    await tick();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ kind: "add", name: "web" });
    expect(draw()).toContain("Added web");
    expect(tracker.services()).toEqual(["api", "db"]);
  });

  it("refuses a name already used", async () => {
    const { press, draw, writes, view } = setup();
    press(`adb${TAB}${TAB}80${ENTER}`);
    await tick();
    expect(draw()).toContain("db already exists");
    expect(writes).toEqual([]);
    expect(view.modals.depth).toBe(1);
  });

  it("closes the form on escape, writing nothing", () => {
    const { press, writes, view } = setup();
    press("aweb");
    press(ESC);
    expect(view.modals.depth).toBe(0);
    expect(writes).toEqual([]);
  });

  it("opens the form of the selected service, filled with what it has", () => {
    const { press, draw } = setup();
    press("e");
    const frame = draw();
    expect(frame).toContain("edit api");
    expect(frame).toMatch(/Address\s+localhost:3000\/health/);
  });

  it("saves what the form changed on a service", async () => {
    const { press, draw, writes } = setup();
    press(`e${TAB}${ENTER}`);
    await tick();
    expect(writes[0]).toMatchObject({ kind: "edit", name: "api" });
    expect(draw()).toContain("Saved api");
  });
});

describe("headers and secrets", () => {
  const typeSecret = async (secret: string, options?: Options) => {
    const test = setup(options);
    test.press(`aweb${TAB}${TAB}8080`);
    for (let i = 0; i < 20 && !test.draw().match(/› Header/); i += 1) test.press(TAB);
    test.press(`Authorization: Bearer ${secret}`);
    return test;
  };

  it("hides the secret typed in a header, at every step", async () => {
    const secret = "s3cr3t-value";
    const test = setup({
      edits: { variableSources: async () => ({}) },
    });
    test.press(`aweb${TAB}${TAB}8080`);
    for (let i = 0; i < 20 && !test.draw().match(/› Header/); i += 1) test.press(TAB);
    test.press(`Authorization: Bearer ${secret}`);
    expect(test.draw()).not.toContain(secret);
    test.press(ENTER);
    await tick();
    const asking = test.draw();
    expect(asking).toContain("Authorization holds a secret");
    expect(asking).toContain("WEB_TOKEN");
    expect(asking).not.toContain(secret);
    test.press(ENTER);
    await tick();
    await tick();
    expect(test.draw()).not.toContain(secret);
    expect(test.kept).toEqual([{ WEB_TOKEN: secret }]);
    const write = test.writes[0] as Extract<ServiceWrite, { kind: "add" }>;
    expect(write.fields.headers).toEqual({ Authorization: `Bearer ${reference("WEB_TOKEN")}` });
    expect(JSON.stringify(write)).not.toContain(secret);
    expect(test.draw()).toContain("Added web, WEB_TOKEN kept in .probe/local.yml");
  });

  it("refuses a secret in clear when nothing can keep it", async () => {
    const secret = "plain-secret";
    const test = await typeSecret(secret);
    test.press(ENTER);
    await tick();
    const frame = test.draw();
    expect(frame).toContain(`Authorization expects a reference, e.g. ${reference("API_TOKEN")}`);
    expect(frame).not.toContain(secret);
    expect(test.writes).toEqual([]);
  });

  it("comes back to the form on escape, the secret still hidden and nothing written", async () => {
    const secret = "back-secret";
    const test = await typeSecret(secret, { edits: { variableSources: async () => ({}) } });
    test.press(ENTER);
    await tick();
    expect(test.draw()).toContain("holds a secret");
    test.press(ESC);
    const frame = test.draw();
    expect(frame).not.toContain("holds a secret");
    expect(frame).not.toContain(secret);
    expect(test.view.modals.depth).toBe(1);
    expect(test.writes).toEqual([]);
  });

  it("refuses for a secret a variable another service sends", async () => {
    const config = {
      ...initial,
      services: {
        ...initial.services,
        db: {
          ...initial.services.db,
          headers: { Authorization: `Bearer ${reference("WEB_TOKEN")}` },
        },
      },
    } as Config;
    const test = await typeSecret("other-secret", {
      config,
      edits: { variableSources: async () => ({}) },
    });
    test.press(ENTER);
    await tick();
    // the proposed name skips WEB_TOKEN, already sent by db
    expect(test.draw()).toContain("WEB_TOKEN_2");
    expect(test.draw()).not.toContain("other-secret");
  });
});

describe("undo and redo", () => {
  it("undoes on z and says what was undone", async () => {
    const onUndo = vi.fn(async () => ({ undone: "Undone: add web", config: initial }));
    const { press, draw, view } = setup({ edits: { onUndo } });
    press("z");
    await tick();
    expect(onUndo).toHaveBeenCalledOnce();
    expect(draw()).toContain("Undone: add web");
    expect(view.modals.depth).toBe(0);
  });

  it("says why nothing was undone", async () => {
    const failure = ".probe/config.yml changed since: nothing undone";
    const { press, draw } = setup({ edits: { onUndo: async () => ({ failure }) } });
    press("z");
    await tick();
    expect(draw()).toContain(failure);
  });

  it("redoes on Z what z undid", async () => {
    const onRedo = vi.fn(async () => ({ undone: "Redone: add web", config: initial }));
    const { press, draw } = setup({ edits: { onRedo } });
    press("Z");
    await tick();
    expect(onRedo).toHaveBeenCalledOnce();
    expect(draw()).toContain("Redone: add web");
  });

  it("puts back the timeouts of the config restored", async () => {
    const restored = {
      ...initial,
      services: { ...initial.services, api: { ...initial.services.api, timeout: 7 } },
    } as Config;
    const onUndo = async () => ({ undone: "Undone: timeout of api", config: restored });
    const { press, view, changed } = setup({ edits: { onUndo } });
    press("z");
    await tick();
    expect(view.timeouts).toEqual({ api: 7 });
    expect(changed).toHaveBeenCalled();
  });

  it("takes z as a letter in the form", () => {
    const onUndo = vi.fn(async () => ({ undone: "x" }));
    const { press, draw } = setup({ edits: { onUndo } });
    press("az");
    expect(onUndo).not.toHaveBeenCalled();
    expect(draw()).toContain("z");
  });
});

describe("command palette", () => {
  const down = `${ESC}[B`;

  it("lists the commands of the keymap with their keys", () => {
    const { press, draw } = setup();
    press(":");
    const frame = draw();
    for (const label of ["Check now", "Service detail", "Quit"]) expect(frame).toContain(label);
    expect(footer(frame)).toContain("run");
  });

  it("opens the help and the filter from the palette", () => {
    const { press, draw, view } = setup();
    press(`:help${ENTER}`);
    expect(view.modals.depth).toBe(1);
    expect(draw()).toContain("Move");
    press("?");
    press(`:filter${ENTER}`);
    expect(view.filtering).toBe(true);
    press("d");
    expect(draw()).toContain("filter d");
  });

  it("runs the command under the cursor", () => {
    const { press, view, draw } = setup();
    press(`:${down}${ENTER}`);
    expect(view.modals.depth).toBe(1);
    expect(draw()).toContain("api@local");
  });

  it("narrows the commands by what is typed", () => {
    const { press, draw } = setup();
    press(":rem");
    const frame = draw();
    expect(frame).toContain("Remove");
    expect(frame).not.toContain("Check now");
  });

  it("adds a service from the palette", () => {
    const { press, draw } = setup();
    press(`:add${ENTER}`);
    expect(draw()).toContain("add a service");
  });

  it("takes q as a letter, closes on escape", () => {
    const { press, view, calls } = setup();
    press(":q");
    expect(calls).toEqual([]);
    press(ESC);
    expect(view.modals.depth).toBe(0);
  });

  it("scrolls the commands on a short terminal, the selected one in sight", () => {
    const { press, draw } = setup();
    press(`:${down.repeat(30)}`);
    const frame = draw(110, 14);
    expect(frame).toContain("Quit");
    expect(frame).not.toContain("Check now");
  });
});

describe("variables of a service", () => {
  const keyed = {
    ...initial,
    services: {
      ...initial.services,
      api: {
        ...initial.services.api,
        headers: {
          Authorization: `Bearer ${reference("API_TOKEN")}`,
          "X-Api-Key": reference("KEY"),
          Cookie: reference("SID"),
        },
      },
    },
  } as Config;
  const sources = async (names: readonly string[]) =>
    Object.fromEntries(
      names.map((name) => [
        name,
        { KEY: "local", SID: "environment" }[name as "KEY" | "SID"] as never,
      ]),
    );
  const DOWN = `${ESC}[B`;
  const SECRET = "variable-secret";

  const open = (edits: Partial<EditCallbacks> = {}) => {
    const test = setup({ config: keyed, edits: { variableSources: sources, ...edits } });
    test.press(ENTER);
    return test;
  };

  it("lists the variables of a service in its panel, with where each is set", async () => {
    const test = open();
    await tick();
    const frame = test.draw();
    expect(frame).toMatch(/API_TOKEN\s+not set/);
    expect(frame).toMatch(/KEY\s+set in local\.yml/);
    expect(frame).toMatch(/SID\s+set in the environment/);
    test.press(DOWN);
    expect(test.draw()).toMatch(/API_TOKEN\s+not set · ↵ sets it/);
    test.press(DOWN);
    expect(test.draw()).toMatch(/KEY\s+set in local\.yml · ↵ changes it/);
  });

  it("sets the variable of a command service from its detail view", async () => {
    const commanded = {
      ...initial,
      services: {
        db: { type: "command", command: ["pg_isready"], env: { PGPASSWORD: reference("DB_PWD") } },
      },
    } as unknown as Config;
    const onVariableWrite = vi.fn(async () => undefined);
    const test = setup({
      config: commanded,
      edits: {
        variableSources: async (names) =>
          Object.fromEntries(names.map((n) => [n, undefined as never])),
        onVariableWrite,
      },
    });
    test.press(ENTER);
    await tick();
    expect(test.draw()).toMatch(/DB_PWD\s+not set/);
    test.press(`${DOWN}${DOWN}${ENTER}${SECRET}${ENTER}`);
    await tick();

    expect(onVariableWrite).toHaveBeenCalledWith("DB_PWD", SECRET);
    expect(test.draw()).not.toContain(SECRET);
  });

  it("takes the value of a variable on enter, never drawn", async () => {
    const onVariableWrite = vi.fn(async () => undefined);
    const test = open({ onVariableWrite });
    await tick();
    test.press(`${DOWN}${DOWN}${ENTER}`);
    expect(test.draw()).toContain("Value of KEY: ");
    expect(test.draw()).toContain("not shown, kept in .probe/local.yml on this machine only");
    test.press(SECRET);
    const typed = test.draw();
    expect(typed).toContain(`Value of KEY: ${"•".repeat(SECRET.length)}`);
    expect(typed).not.toContain(SECRET);
    test.press(ENTER);
    await tick();
    const done = test.draw();
    expect(onVariableWrite).toHaveBeenCalledWith("KEY", SECRET);
    expect(done).toContain("Kept KEY in .probe/local.yml, for this machine only");
    expect(done).not.toContain(SECRET);
  });

  it("keeps nothing for an empty value or on escape", async () => {
    const onVariableWrite = vi.fn(async () => undefined);
    const test = open({ onVariableWrite });
    await tick();
    test.press(`${DOWN}${DOWN}${ENTER}${ENTER}`);
    expect(test.draw()).toContain("KEY expects a value");
    test.press(`abc${ESC}`);
    expect(test.draw()).not.toContain("Value of KEY");
    expect(onVariableWrite).not.toHaveBeenCalled();
  });

  it("does not say a value is kept when keeping it failed", async () => {
    const test = open({ onVariableWrite: async () => ".probe/local.yml is broken" });
    await tick();
    test.press(`${DOWN}${DOWN}${ENTER}${SECRET}${ENTER}`);
    await tick();
    const frame = test.draw();
    expect(frame).toContain("not saved: .probe/local.yml is broken");
    expect(frame).not.toContain("Kept KEY");
    expect(frame).not.toContain(SECRET);
  });

  it("says a variable of the environment is not changed here", async () => {
    const test = open({ onVariableWrite: async () => undefined });
    await tick();
    test.press(`${DOWN.repeat(3)}${ENTER}`);
    const frame = test.draw();
    expect(frame).toContain("SID comes from the environment, which is read first");
    expect(frame).not.toContain("Value of SID");
  });

  it("changes no timeout with the arrows on a variable", async () => {
    const test = open({ onVariableWrite: async () => undefined });
    await tick();
    test.press(`${DOWN}${ESC}[C`);
    expect(test.view.timeouts.api).toBeUndefined();
  });
});

describe("parameters", () => {
  const tenants: Config = {
    ...initial,
    parameters: { env: { values: ["dev", "prod"], strategy: { kind: "query", name: "env" } } },
  } as Config;
  const DOWN = `${ESC}[B`;

  const withWriter = (config: Config = tenants, answer?: () => ParameterWriteOutcome) => {
    const writes: ParameterWrite[] = [];
    const onParameterWrite = vi.fn(async (write: ParameterWrite) => {
      writes.push(write);
      if (answer) return answer();
      const parameters = { ...editing.config().parameters } as Record<string, never>;
      if (write.kind === "remove") delete parameters[write.name];
      else parameters[write.name] = write.parameter as never;
      return { config: { ...editing.config(), parameters } as Config };
    });
    const test = setup({ config, edits: { onParameterWrite } });
    const { editing } = test;
    return { ...test, writes };
  };

  it("opens the panel with nothing declared, to add the first one", () => {
    const { press, draw } = withWriter(initial);
    press("p");
    expect(draw()).toContain("None yet: a adds one");
    press("a");
    expect(draw()).toContain("add a parameter");
  });

  it("says where the parameters are when none can be written", () => {
    const { press, draw } = setup();
    press("p");
    expect(draw().split("\n").at(-1)).toContain(".probe/config.yml declares no parameter");
  });

  it("adds a parameter, then starts the measures again", async () => {
    const { press, draw, writes, changed, view } = withWriter();
    press("pa");
    press(`tenant${DOWN}acme, globex${ENTER}`);
    await tick();
    expect(writes).toEqual([
      {
        kind: "add",
        name: "tenant",
        parameter: { values: ["acme", "globex"], strategy: { kind: "query", name: "tenant" } },
      },
    ]);
    const frame = draw();
    expect(frame).toContain("Added tenant");
    expect(frame).toContain("┤parameters├");
    expect(changed).toHaveBeenCalledWith(true);
    expect(view.modals.depth).toBe(1);
  });

  it("refuses a name that is taken and values that are missing", async () => {
    const { press, draw, writes } = withWriter();
    press(`pa${"env"}${ENTER}`);
    expect(draw()).toContain("env already exists");
    expect(writes).toEqual([]);
    press(`x${DOWN}${ENTER}`);
    expect(draw()).toContain("One value or more, e.g. acme, globex");
    expect(writes).toEqual([]);
  });

  it("edits the parameter under the cursor", async () => {
    const { press, draw, writes } = withWriter();
    press("pe");
    const form = draw();
    expect(form).toContain("edit env");
    expect(form).toContain("dev, prod");
    press(`, qa${ENTER}`);
    await tick();
    expect(writes[0]).toMatchObject({ kind: "edit", name: "env" });
    expect(draw()).toContain("Saved env");
  });

  it("asks before removing a parameter", async () => {
    const { press, draw, writes } = withWriter();
    press("pd");
    expect(draw()).toContain("Remove the parameter env from the config?");
    press("n");
    expect(writes).toEqual([]);
    press("d");
    press("y");
    await tick();
    expect(writes).toEqual([{ kind: "remove", name: "env" }]);
    expect(draw()).toContain("Removed env");
  });

  it("asks before dropping addresses, and writes again once confirmed", async () => {
    let answers = 0;
    const { press, draw, writes } = withWriter(tenants, () => {
      answers += 1;
      return answers === 1
        ? { saved: false, drops: ["api dev"] }
        : { saved: true, config: tenants };
    });
    press(`pe${ENTER}`);
    await tick();
    expect(draw()).toContain("Remove 1 address: api dev?");
    press("y");
    await tick();
    expect(writes[1]).toMatchObject({ kind: "edit", confirmed: true });
  });

  it("goes back to the form when the drops are refused", async () => {
    const { press, draw, writes } = withWriter(tenants, () => ({
      saved: false,
      drops: ["api dev"],
    }));
    press(`pe${ENTER}`);
    await tick();
    press("n");
    expect(draw()).toContain("edit env");
    expect(writes).toHaveLength(1);
  });

  it("shows what the write refused, on the form", async () => {
    const { press, draw } = withWriter(tenants, () => ({
      saved: false,
      problem: { field: "values", message: "dev is not a value" },
    }));
    press(`pe${ENTER}`);
    await tick();
    expect(draw()).toContain("dev is not a value");
  });

  it("does not say a parameter is saved when it was not", async () => {
    const { press, draw } = withWriter(tenants, () => ({ saved: false, failure: "disk is full" }));
    press(`pe${ENTER}`);
    await tick();
    const frame = draw();
    expect(frame).toContain("not saved: disk is full");
    expect(frame).not.toContain("Saved env");
  });

  it("says which file declares a parameter that config.yml does not", () => {
    const { press, draw, view } = withWriter();
    view.choices = { ...view.choices, zone: ["eu"] };
    press(`p${DOWN}`);
    press("l");
    press("e");
    expect(draw()).toContain("zone is not in .probe/config.yml: change it in prod.yml");
  });
});

describe("an empty list", () => {
  it("says how to add the first service", () => {
    const { view, draw } = setup({ config: { schemaVersion: 1, services: {} } as Config });
    view.canAdd = true;
    expect(draw()).toContain("no service: press a to add one");
  });
});

// Real files are read and written: a few turns of the event loop.
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

describe("a new environment", () => {
  const SECRET = "never-copied-value";
  const yaml = [
    "schemaVersion: 1",
    "services:",
    `  api: { host: localhost, port: 3000, headers: { X-Key: '${reference("KEY")}' } }`,
    "",
  ].join("\n");

  async function project(existing: string[] = []) {
    const paths = await tempProject(yaml);
    await writeFile(join(paths.dir, "local.yml"), `variables:\n  KEY: ${SECRET}\n`);
    await mkdir(join(paths.dir, "envs"), { recursive: true });
    for (const name of existing)
      await writeFile(join(paths.dir, "envs", `${name}.yml`), `${yaml}# ${name}\n`);
    const added: string[] = [];
    const test = setup({
      environments: existing,
      edits: {},
      create: async (name, from) => {
        const { variables } = await createEnvironment(paths, name, from);
        added.push(name);
        return `Created ${name} from ${typeof from === "string" ? from : "nothing"}. Sends ${variables.join(", ")}`;
      },
    });
    return { ...test, paths, added };
  }
  const read = (paths: { dir: string }, name: string) =>
    readFile(join(paths.dir, "envs", `${name}.yml`), "utf8");

  it("is offered by n and by the palette", async () => {
    const { press, draw } = await project();
    press("n");
    expect(draw()).toContain("new environment");
    press(ESC);
    press(":");
    press("environment");
    expect(draw()).toContain("New environment");
  });

  it("draws the source chooser with chevrons", async () => {
    const { press, draw } = await project(["dev"]);
    press("n");
    const from =
      draw()
        .split("\n")
        .find((text) => text.includes("Copy from")) ?? "";
    expect(from).toContain("‹");
    expect(from).toContain("›");
  });

  it("copies the services of local, never a secret value, and shows the new tab", async () => {
    const { press, draw, paths, tracker, view, added } = await project();
    press("nprod");
    press(ENTER);
    await settle();
    expect(added).toEqual(["prod"]);
    const copy = await read(paths, "prod");
    expect(copy).toBe(yaml);
    expect(copy).not.toContain(SECRET);
    expect(tracker.environments).toContain("prod");
    expect(view.tab).toBe(tracker.environments.indexOf("prod") + 1);
    const frame = draw();
    expect(frame).toContain("prod");
    expect(frame).toContain("Created prod from local");
    expect(frame).not.toContain(SECRET);
    expect(view.modals.depth).toBe(0);
  });

  it("copies from another environment when it is chosen", async () => {
    const { press, paths } = await project(["staging"]);
    press(`nqa${"\t"}`);
    press(`${ESC}[C`);
    press(ENTER);
    await settle();
    expect(await read(paths, "qa")).toContain("# staging");
  });

  it.each([
    ["bad name", "an environment name is made of letters, digits, _ and -, e.g. prod."],
    ["local", "local is .probe/config.yml: pick another name."],
    ["staging", ".probe/envs/staging.yml is already there: edit it, or pick another name."],
  ])("refuses %j", async (name, message) => {
    const { press, draw, added } = await project(["staging"]);
    press(`n${name}`);
    press(ENTER);
    await settle();
    expect(draw()).toContain(message);
    expect(added).toEqual([]);
  });

  it("keeps the form open when the file turned up meanwhile", async () => {
    const { press, draw, paths } = await project();
    await writeFile(join(paths.dir, "envs", "late.yml"), "x");
    press("nlate");
    press(ENTER);
    await settle();
    expect(draw()).toContain("is already there");
  });

  it("starts the checks of an environment added to a running monitor", async () => {
    const ran: string[] = [];
    const monitor = new Monitor([], {
      intervalMs: 60_000,
      onResults: (env) => void ran.push(env),
      onFailure: () => {},
    });
    monitor.add({ name: "prod", run: async () => [answered("api")] });
    await settle();
    monitor.stop();
    expect(ran).toEqual(["prod"]);
  });
});

describe("a pass under old settings", () => {
  it("drops its results and runs again with the new ones", async () => {
    const seen: string[] = [];
    let release: () => void = () => {};
    let runs = 0;
    const monitor = new Monitor(
      [
        {
          name: "local",
          run: async () => {
            runs += 1;
            const mine = runs;
            if (mine === 1) await new Promise<void>((resolve) => (release = resolve));
            return [answered(`pass${mine}`)];
          },
        },
      ],
      {
        intervalMs: 60_000,
        onResults: (_env, results) => void seen.push(...results.map(({ name }) => name)),
        onFailure: () => {},
      },
    );
    monitor.refresh();
    await tick();
    monitor.invalidate();
    monitor.refresh();
    release();
    await settle();
    monitor.stop();
    expect(seen).toEqual(["pass2"]);
  });
});

describe("a failed save", () => {
  const DOWN = `${ESC}[B`;

  it("stays on the header until a save succeeds", async () => {
    let failing = true;
    const { press, draw } = setup({
      edits: {
        onServiceWrite: async (write) => {
          if (failing) return { failure: "disk is full" };
          return {
            config: { ...initial, services: { ...initial.services, [write.name]: {} } } as Config,
          };
        },
      },
    });
    press("dy");
    await tick();
    expect(draw().split("\n")[0]).toContain("not saved: disk is full");
    press(DOWN);
    expect(draw(110, 32).split("\n")[0]).toContain("not saved: disk is full");
    failing = false;
    press("dy");
    await tick();
    expect(draw().split("\n")[0]).not.toContain("not saved");
  });
});

describe("the bar", () => {
  it("offers the parameter panel when a writer exists, even with none declared", () => {
    const { view, draw } = setup();
    expect(draw().split("\n").at(-1)).not.toContain("p parameters");
    view.canEditParameters = true;
    expect(draw().split("\n").at(-1)).toContain("p parameters");
  });
});

describe("an empty environment", () => {
  it("is the last choice of Copy from, whatever the sources", async () => {
    const created: EnvironmentOrigin[] = [];
    const { press, draw } = setup({
      environments: ["dev"],
      create: async (_name, from) => {
        created.push(from);
        return "Created";
      },
    });
    press("nqa");
    press(TAB);
    expect(draw()).toMatch(/Copy from\s+‹?\s*local/);
    press(`${ESC}[D`);
    expect(draw()).toMatch(/Copy from\s+‹ dev|Copy from\s+‹?\s*empty/);
    press(ENTER);
    await settle();
    expect(created).toEqual([EMPTY_ENVIRONMENT]);
  });

  it("creates its file with a schema version and no service", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices:\n  api: { port: 3000 }\n");
    await writeFile(join(paths.dir, "local.yml"), "variables:\n  KEY: kept\n");

    const { variables } = await createEnvironment(paths, "qa", EMPTY_ENVIRONMENT);

    expect(variables).toEqual([]);
    expect(await readFile(join(paths.dir, "envs", "qa.yml"), "utf8")).toBe(
      "schemaVersion: 1\nservices: {}\n",
    );
    const { config } = await loadConfig({ ...paths, config: join(paths.dir, "envs", "qa.yml") });
    expect(config.services).toEqual({});
  });

  it("refuses a name that is taken, and never overwrites the file", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices: {}\n");
    await mkdir(join(paths.dir, "envs"));
    await writeFile(join(paths.dir, "envs", "qa.yml"), "# mine\n");

    await expect(createEnvironment(paths, "qa", EMPTY_ENVIRONMENT)).rejects.toThrow(
      "already there",
    );
    expect(await readFile(join(paths.dir, "envs", "qa.yml"), "utf8")).toBe("# mine\n");
  });
});

describe("removing an environment", () => {
  const prod = () => {
    const removed: string[] = [];
    const made = setup({
      environments: ["prod"],
      remove: async (name) => {
        removed.push(name);
        return undefined;
      },
    });
    return { ...made, removed };
  };

  it("asks first, naming the file and what stays", () => {
    const { press, draw, view, removed } = prod();
    view.tab = 2;
    press("D");
    const frame = draw();
    expect(frame).toContain("Remove prod?");
    expect(frame).toContain(".probe/envs/prod.yml is deleted");
    expect(frame).toContain("Its values in .probe/local.yml stay.");
    expect(removed).toEqual([]);
  });

  it("deletes after y, and says the values stay and z undoes", async () => {
    const { press, draw, view, removed, changed } = prod();
    view.tab = 2;
    press("Dy");
    await tick();
    expect(removed).toEqual(["prod"]);
    expect(draw()).toContain("Removed prod");
    expect(draw()).toContain("its values in .probe/local.yml stay");
    expect(changed).toHaveBeenCalled();
  });

  it("keeps the environment on n or escape", async () => {
    const { press, view, removed } = prod();
    view.tab = 2;
    press("Dn");
    press(`D${ESC}`);
    await tick();
    expect(removed).toEqual([]);
  });

  it("says why it was not removed, and not that it was", async () => {
    const { press, draw, view } = setup({
      environments: ["prod"],
      remove: async () => ".probe/envs/prod.yml is already gone",
    });
    view.tab = 2;
    press("Dy");
    await tick();
    const frame = draw();
    expect(frame).toContain("not saved: .probe/envs/prod.yml is already gone");
    expect(frame).not.toContain("Removed prod");
  });

  it("cannot remove local", () => {
    const { press, draw, view, removed } = prod();
    view.tab = 1;
    press("D");
    expect(draw()).toContain("local is .probe/config.yml: it cannot be removed");
    expect(draw()).not.toContain("Remove local?");
    expect(removed).toEqual([]);
  });

  it("asks for an environment tab on the all tab", () => {
    const { press, draw, removed } = prod();
    press("D");
    expect(draw()).toContain("Open the tab of an environment to remove it");
    expect(removed).toEqual([]);
  });

  it("is in the palette and the help", () => {
    const { press, draw } = prod();
    press(":");
    press("remove env");
    expect(draw()).toContain("Remove the environment");
    press(ESC);
    press("?");
    expect(draw()).toContain("Remove env");
  });

  it("is offered nowhere when no environment can be removed", () => {
    const { press, draw, view } = setup({ environments: ["prod"] });
    view.tab = 2;
    press("D");
    expect(draw()).not.toContain("Remove prod?");
  });
});

describe("the tabs follow the environment files", () => {
  it("forgets an environment and what it measured", () => {
    const tracker = new Tracker(["local", "prod"]);
    tracker.record("local", [answered("api")], 1);
    tracker.record("prod", [answered("api"), answered("globex")], 1);

    tracker.remove("prod");

    expect(tracker.environments).toEqual(["local"]);
    expect(tracker.services()).toEqual(["api"]);
    expect(tracker.result("api", "prod")).toBeUndefined();
    expect(tracker.result("api", "local")).toBeDefined();
  });

  it("stops checking an environment taken out of a running monitor", async () => {
    const ran: string[] = [];
    const monitor = new Monitor([], {
      intervalMs: 5,
      onResults: (env) => void ran.push(env),
      onFailure: () => {},
    });
    monitor.add({ name: "prod", run: async () => [answered("api")] });
    monitor.add({ name: "dev", run: async () => [answered("api")] });
    await settle();
    monitor.remove("prod");
    ran.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 40));
    monitor.stop();
    expect(ran).toContain("dev");
    expect(ran).not.toContain("prod");
  });
});

describe("editing on an environment tab", () => {
  const prodConfig = {
    schemaVersion: 1,
    services: { globex: { url: "https://globex.example.com" } },
  } as unknown as Config;

  function inProd() {
    const made = setup({ environments: ["prod"] });
    made.editing.observe?.("prod", prodConfig);
    made.tracker.record("prod", [answered("globex")], 1);
    return made;
  }

  it("no longer refuses: d asks, then removes from the environment file", async () => {
    const { press, draw, writes, view } = inProd();
    view.tab = 2;
    press("d");
    expect(draw()).toContain("Remove globex from prod?");
    press("y");
    await tick();
    expect(writes).toEqual([{ kind: "remove", name: "globex", env: "prod" }]);
    expect(draw()).not.toContain("is not edited here");
  });

  it("opens the form of a service with the target in its title", () => {
    const { press, draw, view } = inProd();
    view.tab = 2;
    press("e");
    expect(draw()).toContain("edit globex in prod");
    expect(draw()).toContain("globex.example.com");
  });

  it("a adds to that environment only", async () => {
    const { press, draw, view, writes } = inProd();
    view.tab = 2;
    press("a");
    expect(draw()).toContain("add to prod");
    press(`initech${TAB}${TAB}8080${ENTER}`);
    await tick();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ kind: "add", name: "initech", env: "prod" });
  });

  it("a on the all tab adds to local, as before", () => {
    const { press, draw, view } = inProd();
    expect(view.tab).toBe(0);
    press("a");
    expect(draw()).toContain("add a service");
    expect(draw()).not.toContain("add to");
  });

  it("on the all tab, e and d target the column of the selected service", async () => {
    const { press, draw, writes } = inProd();
    // api and db answer in local, globex only in prod: the cursor goes to globex.
    press("jjd");
    expect(draw()).toContain("Remove globex from prod?");
    press("y");
    await tick();
    expect(writes).toEqual([{ kind: "remove", name: "globex", env: "prod" }]);
  });

  it("on the all tab, a service of local is still removed from local", async () => {
    const { press, writes } = inProd();
    press("dy");
    await tick();
    expect(writes).toEqual([{ kind: "remove", name: "api" }]);
  });

  describe("variables in the detail panel", () => {
    const DOWN = `${ESC}[B`;
    const SECRET = "prod-only-secret";
    const keyed = {
      schemaVersion: 1,
      services: {
        globex: {
          url: "https://globex.example.com",
          headers: { Authorization: `Bearer ${reference("GLOBEX_TOKEN")}` },
        },
      },
    } as unknown as Config;
    const looked: Array<string | undefined> = [];
    const sources = async (names: readonly string[], env?: string) => {
      looked.push(env);
      return env === "prod"
        ? Object.fromEntries(names.map((name) => [name, "local" as const]))
        : {};
    };

    function inProdWithVariables(onVariableWrite = vi.fn(async () => undefined)) {
      looked.length = 0;
      const made = setup({
        environments: ["prod"],
        edits: { variableSources: sources, onVariableWrite },
      });
      made.editing.observe?.("prod", keyed);
      made.tracker.record("prod", [answered("globex")], 1);
      return { ...made, onVariableWrite };
    }

    it("lists the variables on the tab, read in that environment's scope", async () => {
      const { press, draw, view } = inProdWithVariables();
      view.tab = 2;
      press(ENTER);
      await tick();
      expect(draw()).toMatch(/GLOBEX_TOKEN\s+set in local\.yml/);
      expect(looked).toContain("prod");
      expect(draw()).not.toContain("skip");
    });

    it("sets the value under that environment, never drawn", async () => {
      const { press, draw, view, onVariableWrite } = inProdWithVariables();
      view.tab = 2;
      press(ENTER);
      await tick();
      press(`${DOWN}${ENTER}${SECRET}`);
      expect(draw()).not.toContain(SECRET);
      press(ENTER);
      await tick();
      expect(onVariableWrite).toHaveBeenCalledWith("GLOBEX_TOKEN", SECRET, "prod");
      const done = draw();
      expect(done).toContain("Kept GLOBEX_TOKEN in .probe/local.yml, under envs.prod");
      expect(done).not.toContain(SECRET);
    });

    it("targets the column of the selected service on the all tab", async () => {
      const { press, onVariableWrite } = inProdWithVariables();
      press("jj");
      press(ENTER);
      await tick();
      press(`${DOWN}${ENTER}${SECRET}${ENTER}`);
      await tick();
      expect(onVariableWrite).toHaveBeenCalledWith("GLOBEX_TOKEN", SECRET, "prod");
    });

    it("shows no row of local for an environment not read yet", async () => {
      const made = setup({ environments: ["prod"], edits: { variableSources: sources } });
      made.tracker.record("prod", [answered("globex")], 1);
      made.view.tab = 2;
      made.press(ENTER);
      await tick();
      expect(made.draw()).not.toContain("GLOBEX_TOKEN");
    });
  });

  it("undo and redo work from an environment tab", async () => {
    const onUndo = vi.fn(async () => ({ undone: "Undone: edit globex" }));
    const onRedo = vi.fn(async () => ({ undone: "Redone: edit globex" }));
    const { press, view } = setup({ environments: ["prod"], edits: { onUndo, onRedo } });
    view.tab = 2;
    press("zZ");
    await tick();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it("keeps a secret typed on prod for prod, and names the right files", async () => {
    const secret = "s3cr3t-value";
    const test = setup({
      environments: ["prod"],
      edits: { variableSources: async () => ({}) },
    });
    test.editing.observe?.("prod", prodConfig);
    test.view.tab = 2;
    test.press(`ainitech${TAB}${TAB}8080`);
    for (let i = 0; i < 20 && !test.draw().match(/› Header/); i += 1) test.press(TAB);
    test.press(`Authorization: Bearer ${secret}`);
    test.press(ENTER);
    await tick();
    const asking = test.draw();
    expect(asking).toContain(".probe/envs/prod.yml gets a reference");
    expect(asking).toContain("for prod only");
    expect(asking).not.toContain(secret);
    test.press(ENTER);
    await tick();
    await tick();
    const frame = test.draw();
    expect(frame).toContain("INITECH_TOKEN kept in .probe/local.yml, under envs.prod");
    expect(frame).not.toContain(secret);
    expect(test.kept).toEqual([{ INITECH_TOKEN: secret }]);
    expect(test.writes[0]).toMatchObject({ kind: "add", name: "initech", env: "prod" });
    expect(JSON.stringify(test.writes)).not.toContain(secret);
  });

  it("says so when the environment has not been read yet", () => {
    const { press, draw, view } = setup({ environments: ["prod"] });
    view.tab = 2;
    press("a");
    expect(draw()).toContain("prod is not read yet");
  });
});
