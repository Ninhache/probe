import { describe, expect, it } from "vitest";
import { searchRows } from "../src/dashboard/native/help";
import { Tracker } from "../src/dashboard/native/history";
import { whatsNewModal } from "../src/dashboard/native/news";
import { handleInput, initialView, renderDashboard } from "../src/dashboard/native/view";
import type { InputEvent } from "../src/tui/input";
import { Screen } from "../src/tui/screen";
import { newsOf } from "../src/update/whats-new";

const key = (name: string, extra: Partial<InputEvent> = {}): InputEvent =>
  ({ kind: "key", name, ctrl: false, alt: false, shift: false, raw: name, ...extra }) as InputEvent;
const actions = { quit: () => {}, refresh: () => {} };

const news = newsOf({
  current: "1.2.0",
  from: "1.1.0",
  notes: [{ version: "1.2.0", items: [{ kind: "info", text: "grouped help" }] }],
});

const draw = (view: ReturnType<typeof initialView>) => {
  const screen = new Screen(100, 30, "truecolor");
  renderDashboard(screen, { x: 0, y: 0, w: 100, h: 30 }, new Tracker(["local"]), view, 0);
  return screen.toPlainText();
};

describe("what's new in the dashboard", () => {
  it("should show the modal and close it with Esc", () => {
    const view = initialView();
    view.modals.push(whatsNewModal(news));

    expect(draw(view)).toContain("What's new · 1.2.0");
    expect(draw(view)).toContain("grouped help");
    handleInput(key("escape"), new Tracker(["local"]), view, actions);

    expect(view.modals.depth).toBe(0);
    expect(draw(view)).not.toContain("What's new");
  });

  it("should open again on W, and say so when there is nothing", () => {
    const tracker = new Tracker(["local"]);
    const view = initialView();
    view.news = () => news;

    handleInput(key("W", { shift: true }), tracker, view, actions);
    expect(draw(view)).toContain("What's new · 1.2.0");

    const bare = initialView();
    handleInput(key("W", { shift: true }), tracker, bare, actions);
    expect(bare.modals.depth).toBe(0);
  });

  it("should be findable in the help search", () => {
    const rows = searchRows("what's new", false).map(({ cells }) =>
      cells.map((c) => c.text).join(" "),
    );

    expect(rows.join("\n")).toMatch(/W\s+What.s new/);
  });
});
