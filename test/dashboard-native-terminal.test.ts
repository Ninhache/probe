import { describe, expect, it } from "vitest";
import type { CheckResult } from "../src/checkers/types";
import { Tracker } from "../src/dashboard/native/history";
import {
  handleInput,
  initialView,
  renderDashboard,
  say,
  type ViewActions,
} from "../src/dashboard/native/view";
import { drawFrame } from "../src/tui/app";
import { detectColorMode } from "../src/tui/color";
import type { InputEvent } from "../src/tui/input";
import { Screen } from "../src/tui/screen";
import { supportsUnicode } from "../src/ui/terminal";

const key = (name: string): InputEvent =>
  ({ kind: "key", name, ctrl: false, alt: false, shift: false, raw: name }) as InputEvent;

const up = (name: string): CheckResult => ({
  name,
  type: "http",
  ok: true,
  target: `http://127.0.0.1:4101/${name}`,
  latencyMs: 12,
  status: 200,
  method: "GET",
});

function setup() {
  const tracker = new Tracker(["local"]);
  tracker.record("local", [up("api"), up("db")], 1);
  return { tracker, view: initialView() };
}

const SGR = new RegExp(`${String.fromCharCode(27)}\\[([0-9;]*)m`, "g");
const MIN = { w: 60, h: 16 };
const frame = (screen: Screen, tracker: Tracker, view: ReturnType<typeof initialView>) =>
  drawFrame(screen, MIN, (s, area) => renderDashboard(s, area, tracker, view, 0));

describe("native screen on a limited terminal", () => {
  it("should emit no colour sequence when NO_COLOR is set", () => {
    const { tracker, view } = setup();
    const mode = detectColorMode({ NO_COLOR: "1", COLORTERM: "truecolor" }, true);
    const screen = new Screen(100, 30, mode);

    frame(screen, tracker, view);
    const out = screen.flush();

    expect(out).toContain("api");
    const params = [...out.matchAll(SGR)].flatMap((m) => (m[1] ?? "").split(";"));
    expect(params.length).toBeGreaterThan(0);
    for (const param of params) expect(["0", "1", "2", "3", "4", "7", ""]).toContain(param);
  });

  it("should show the too small message below the minimum size", () => {
    const { tracker, view } = setup();
    const screen = new Screen(59, 20, "none");

    frame(screen, tracker, view);

    expect(screen.toPlainText()).toContain("Terminal too small: 59x20, need 60x16");
    expect(screen.toPlainText()).not.toContain("api");
  });

  it("should lay out at 60 columns with every line inside the width", () => {
    const { tracker, view } = setup();
    const screen = new Screen(60, 20, "none");

    frame(screen, tracker, view);
    const lines = screen.toPlainText().split("\n");

    expect(screen.toPlainText()).toContain("api");
    expect(screen.toPlainText()).toContain("q quit");
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(60);
  });

  it("should redraw at the new size after a resize", () => {
    const { tracker, view } = setup();
    const screen = new Screen(100, 30, "none");
    frame(screen, tracker, view);

    screen.resize(70, 18);
    frame(screen, tracker, view);
    const lines = screen.toPlainText().split("\n");

    expect(lines).toHaveLength(18);
    expect(lines[0]).toContain("probe");
    expect(lines.at(-1)).toContain("q quit");
    expect(screen.flush()).toContain("api");
  });

  it("should draw only ASCII when asked to", () => {
    const { tracker, view } = setup();
    const screen = new Screen(100, 30, "none");
    screen.ascii = true;

    frame(screen, tracker, view);
    const text = screen.toPlainText();

    expect(text).toContain("+-");
    expect(text).toContain("api");
    expect(text).not.toMatch(/[^\x20-\x7e\n]/);
  });

  it("should keep the box glyphs by default", () => {
    const { tracker, view } = setup();
    const screen = new Screen(100, 30, "none");

    frame(screen, tracker, view);

    expect(screen.toPlainText()).toContain("╭");
  });

  it.each([
    [{ LANG: "fr_FR.UTF-8" }, true],
    [{ LC_ALL: "C", LANG: "en_US.UTF-8" }, false],
    [{ LC_CTYPE: "en_US.utf8" }, true],
    [{ LANG: "C" }, false],
    [{}, false],
    [{ TERM: "linux", LANG: "en_US.UTF-8" }, false],
    [{ PROBE_ASCII: "1", LANG: "en_US.UTF-8" }, false],
    [{ PROBE_ASCII: "0", LANG: "en_US.UTF-8" }, true],
    [{ PROBE_ASCII: "", LANG: "en_US.UTF-8" }, true],
  ])("should read the locale %j as unicode: %s", (env, unicode) => {
    expect(supportsUnicode(env)).toBe(unicode);
  });
});

describe("what an action said", () => {
  const actions: ViewActions = { quit() {}, refresh() {} };

  it("should clear at the next key", () => {
    const { tracker, view } = setup();
    say(view, "Copied the curl command");

    handleInput(key("down"), tracker, view, actions);

    expect(view.status).toBeUndefined();
  });

  it("should keep a status the key itself said", () => {
    const { tracker, view } = setup();
    say(view, "old");
    const next: ViewActions = { ...actions, refresh: () => say(view, "Checking") };

    handleInput(key("r"), tracker, view, next);

    expect(view.status?.text).toBe("Checking");
  });

  it("should stay through a mouse event", () => {
    const { tracker, view } = setup();
    say(view, "Copied");

    handleInput(
      { kind: "mouse", action: "wheel-down", button: "none", x: 1, y: 1, raw: "" },
      tracker,
      view,
      actions,
    );

    expect(view.status?.text).toBe("Copied");
  });
});
