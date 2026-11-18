import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import { createEnvironment } from "../src/commands/env-create";
import type { ParameterWrite } from "../src/commands/parameter-writes";
import type { ServiceWrite } from "../src/commands/service-writes";
import { reference } from "../src/config/headers";
import { parameterChoices } from "../src/config/parameters";
import type { Config } from "../src/config/schema";
import type { ParameterWriteOutcome } from "../src/dashboard/Dashboard";
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
  create?: (name: string, from: string) => Promise<string>;
  edits?: Partial<EditCallbacks>;
  config?: Config;
  environments?: string[];
}

function setup({ edits = {}, config = initial, environments = [], create }: Options = {}) {
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
    fileOf: (env) => (env === "local" ? undefined : `${env}.yml`),
    declaredIn: () => ["prod.yml"],
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

  it("says another environment is not edited here", () => {
    const { press, draw, view } = setup({ environments: ["staging"] });
    view.tab = 2;
    press("d");
    expect(draw()).toContain("staging is not edited here: change staging.yml");
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
    press(`aweb${TAB}8080${ENTER}`);
    await tick();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ kind: "add", name: "web" });
    expect(draw()).toContain("Added web");
    expect(tracker.services()).toEqual(["api", "db"]);
  });

  it("refuses a name already used", async () => {
    const { press, draw, writes, view } = setup();
    press(`adb${TAB}80${ENTER}`);
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
    test.press(`aweb${TAB}8080`);
    for (let i = 0; i < 20 && !test.draw().match(/› Header/); i += 1) test.press(TAB);
    test.press(`Authorization: Bearer ${secret}`);
    return test;
  };

  it("hides the secret typed in a header, at every step", async () => {
    const secret = "s3cr3t-value";
    const test = setup({
      edits: { variableSources: async () => ({}) },
    });
    test.press(`aweb${TAB}8080`);
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
    expect(draw()).toContain("List");
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
        return `Created ${name} from ${from}. Sends ${variables.join(", ")}`;
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
