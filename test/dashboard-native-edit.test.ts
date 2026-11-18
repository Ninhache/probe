import { describe, expect, it, vi } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import type { ServiceWrite } from "../src/commands/service-writes";
import { reference } from "../src/config/headers";
import type { Config } from "../src/config/schema";
import { type EditCallbacks, liveEditing, timeoutsOf } from "../src/dashboard/editing";
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
  edits?: Partial<EditCallbacks>;
  config?: Config;
  environments?: string[];
}

function setup({ edits = {}, config = initial, environments = [] }: Options = {}) {
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
    timeouts: timeoutsOf(config),
  });
  const tracker = new Tracker(["local", ...environments]);
  tracker.record("local", Object.keys(config.services).map(answered), 1);
  const changed = vi.fn();
  const edit = createEditor({
    view,
    tracker,
    editing,
    changed: () => {
      tracker.retain("local", new Set(Object.keys(editing.config().services)));
      changed();
    },
    redraw: () => {},
    fileOf: (env) => (env === "local" ? undefined : `${env}.yml`),
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
    press(`:${down.repeat(13)}`);
    const frame = draw(110, 14);
    expect(frame).toContain("Quit");
    expect(frame).not.toContain("Check now");
  });
});
