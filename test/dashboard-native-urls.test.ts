import { describe, expect, it } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import type { ParameterWrite } from "../src/commands/parameter-writes";
import type { ServiceWrite } from "../src/commands/service-writes";
import { parameterChoices } from "../src/config/parameters";
import type { Config } from "../src/config/schema";
import { liveEditing } from "../src/dashboard/editing";
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

const TAB = "\t";
const ENTER = "\r";
const DOWN = "\x1b[B";
const CTRL_U = "\x15";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const ADDRESS = { host: "localhost", port: 3000, path: "/health" };
const withUrls = {
  schemaVersion: 1,
  parameters: { env: { values: ["dev", "prod"], strategy: { kind: "url" } } },
  services: { api: { ...ADDRESS, urls: { prod: "https://example.com/health" } } },
} as unknown as Config;
const plain = { schemaVersion: 1, services: { api: ADDRESS } } as Config;
const byUrl = {
  schemaVersion: 1,
  services: { api: { url: "https://api.example.com/health", port: 443, path: "/health" } },
} as unknown as Config;

function open(config: Config) {
  const services: ServiceWrite[] = [];
  const parameters: ParameterWrite[] = [];
  const editing = liveEditing(config, {
    onServiceWrite: async (write) => {
      services.push(write);
      return { config };
    },
    onParameterWrite: async (write) => {
      parameters.push(write);
      return { config };
    },
  });
  const view = initialView({ choices: parameterChoices(config) });
  const tracker = new Tracker(["local"]);
  const edit = createEditor({
    view,
    tracker,
    editing,
    changed: () => {},
    redraw: () => {},
    declaredIn: () => [],
  });
  const actions: ViewActions = { quit() {}, refresh() {}, edit };
  const draw = (w = 110, h = 32) => {
    const screen = new Screen(w, h, "truecolor");
    renderDashboard(screen, { x: 0, y: 0, w, h }, tracker, view, 0);
    return screen.toPlainText();
  };
  const press = (text: string) => {
    for (const event of parseInput(text)) handleInput(event, tracker, view, actions);
  };
  draw();
  const up = Object.keys(config.services).map(
    (name) => ({ name, type: "http", ok: true, target: name, latencyMs: 1 }) as CheckResult,
  );
  tracker.record("local", up, 1);
  return { draw, press, services, parameters, view };
}

describe("the service form with a url parameter", () => {
  it("gives a URL line per value, before the address", () => {
    const { press, draw } = open(withUrls);
    press("e");
    const frame = draw();

    expect(frame).toContain("URL prod  https://example.com/health");
    expect(frame.indexOf("URL dev")).toBeLessThan(frame.indexOf("Address"));
    expect(frame).toContain("An address under env replaces");
  });

  it("sends every URL, with http:// when none is given", async () => {
    const { press, services } = open(withUrls);
    press(`e${"localhost:3001"}${ENTER}`);
    await tick();

    expect(services.at(-1)).toMatchObject({
      kind: "edit",
      urls: { dev: "http://localhost:3001", prod: "https://example.com/health" },
      fields: { port: 3000 },
    });
  });

  it("points at a URL the config would refuse, writing nothing", async () => {
    const { press, draw, services } = open(withUrls);
    press(`e${DOWN}${CTRL_U}ftp://example.com${ENTER}`);
    await tick();

    expect(draw()).toContain("URL prod expects an http:// or https:// URL");
    expect(services).toEqual([]);
  });

  it("sends no address of its own when every URL is filled and the address is emptied", async () => {
    const { press, services } = open(withUrls);
    press(`elocalhost:3001${DOWN}${DOWN}${CTRL_U}${ENTER}`);
    await tick();

    const fields = (services.at(-1) as { fields?: object } | undefined)?.fields;
    expect(fields).toBeDefined();
    expect(fields).not.toHaveProperty("port");
    expect(fields).not.toHaveProperty("url");
  });

  it("still asks for an address when a URL is left empty", async () => {
    const { press, draw, services } = open(withUrls);
    press(`e${DOWN}${DOWN}${CTRL_U}${ENTER}`);
    await tick();

    expect(draw()).toContain("An address, e.g. localhost:3000");
    expect(services).toEqual([]);
  });

  it("keeps the fields after the URLs: the port is still edited", async () => {
    const { press, services } = open(withUrls);
    press(`e${DOWN}${DOWN}${CTRL_U}4000${ENTER}`);
    await tick();

    expect(services.at(-1)).toMatchObject({ fields: { port: 4000 } });
  });
});

describe("the parameter form with a url parameter", () => {
  it("lists a line per service and value", () => {
    const { press, draw } = open(withUrls);
    press("pe");
    const frame = draw();

    expect(frame).toContain("Addresses (empty: the service address)");
    expect(frame).toContain("api dev");
    expect(frame).toContain("api prod  https://example.com/health");
  });

  it("sends the addresses typed, with http:// when none is given", async () => {
    const { press, parameters } = open(withUrls);
    press(`pe${DOWN}${DOWN}localhost:3001${ENTER}`);
    await tick();

    expect(parameters.at(-1)).toMatchObject({
      kind: "edit",
      addresses: { api: { dev: "http://localhost:3001" } },
    });
  });

  it("points at an address the config would refuse", async () => {
    const { press, draw, parameters } = open(withUrls);
    press(`pe${DOWN}${DOWN}ftp://example.com${ENTER}`);
    await tick();

    expect(draw()).toContain("api dev: expects an http:// or https:// URL");
    expect(parameters).toEqual([]);
  });
});

describe("an address by url", () => {
  it("opens a service declared by url with its url as the address", () => {
    const { press, draw } = open(byUrl);
    press("e");

    expect(draw()).toContain("Address  https://api.example.com/health");
  });

  it("keeps the url of a service when only its status changes", async () => {
    const { press, services } = open(byUrl);
    press(`e${TAB}204${ENTER}`);
    await tick();

    expect(services.at(-1)).toMatchObject({
      kind: "edit",
      name: "api",
      fields: { url: "https://api.example.com/health", port: 443, expect: 204 },
    });
  });

  it("adds a service by an https address without a port", async () => {
    const { press, services } = open(plain);
    press(`aweb${TAB}${TAB}https://api.example.com/health${ENTER}`);
    await tick();

    expect(services.at(-1)).toMatchObject({
      kind: "add",
      fields: { url: "https://api.example.com/health", port: 443 },
    });
  });

  it("refuses an address with a password without repeating it in the problem", async () => {
    const { press, draw, services } = open(plain);
    press(`aweb${TAB}${TAB}https://admin:hunter2@api.example.com${ENTER}`);
    await tick();

    const problem = draw()
      .split("\n")
      .find((line) => line.includes("Expected a URL without a user or a password"));
    expect(problem).toBeDefined();
    expect(problem).not.toContain("hunter2");
    expect(services).toEqual([]);
  });
});
