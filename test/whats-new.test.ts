import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bashScript } from "../src/completion/bash";
import { fishScript } from "../src/completion/fish";
import { completionMarker, markerVersion } from "../src/completion/marker";
import { powershellScript } from "../src/completion/powershell";
import { zshScript } from "../src/completion/zsh";
import { LAST_SEEN_FILE, RELEASES_URL, UPDATE_CACHE_FILE } from "../src/constants";
import { isNewer } from "../src/update/notifier";
import { RELEASE_NOTES, type ReleaseNotes } from "../src/update/release-notes";
import { completionPlaces, staleCompletions } from "../src/update/stale-completion";
import {
  currentNotes,
  MAX_NEWS_LINES,
  markFirstRun,
  newsOf,
  renderNews,
  takeWhatsNew,
  whatsNewNotice,
} from "../src/update/whats-new";
import { tempDir } from "./helpers";

const notes: ReleaseNotes[] = [
  { version: "1.2.0", items: [{ kind: "info", text: "third" }] },
  {
    version: "1.1.0",
    items: [
      { kind: "info", text: "second" },
      { kind: "schema", text: "second needs the new schema" },
    ],
  },
  { version: "1.0.0", items: [{ kind: "info", text: "first" }] },
];

const seen = (dir: string) => readFile(join(dir, LAST_SEEN_FILE), "utf8").catch(() => null);
const versionsOf = (dir: string, current: string) =>
  takeWhatsNew(current, dir, notes)?.notes.map(({ version }) => version);

describe("the release notes", () => {
  it("should have notes for the version of package.json, or for the release being prepared", async () => {
    const { version } = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
    const newest = RELEASE_NOTES[0]?.version ?? "0.0.0";

    expect(isNewer(version, newest)).toBe(false);
    expect(RELEASE_NOTES.map((entry) => entry.version)).toContain(version);
  });

  it("should list the versions newest first, each with 1 to 3 lines", () => {
    const versions = RELEASE_NOTES.map((entry) => entry.version);

    expect(versions).toEqual(
      [...versions].sort((a, b) => b.localeCompare(a, "en", { numeric: true })),
    );
    for (const { items } of RELEASE_NOTES) expect(items.length).toBeGreaterThanOrEqual(1);
    for (const { items } of RELEASE_NOTES) expect(items.length).toBeLessThanOrEqual(3);
  });
});

describe("takeWhatsNew", () => {
  it("should say nothing on a first install, and remember the version", async () => {
    const dir = await tempDir();

    expect(takeWhatsNew("1.2.0", dir, notes)).toBeNull();
    expect(await seen(dir)).toBe("1.2.0");
  });

  it("should show the versions skipped once, then nothing", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, LAST_SEEN_FILE), "1.0.0");

    expect(versionsOf(dir, "1.2.0")).toEqual(["1.2.0", "1.1.0"]);
    expect(await seen(dir)).toBe("1.2.0");
    expect(takeWhatsNew("1.2.0", dir, notes)).toBeNull();
  });

  it("should leave out the versions above the running one", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, LAST_SEEN_FILE), "1.0.0");

    expect(versionsOf(dir, "1.1.0")).toEqual(["1.1.0"]);
  });

  it("should show only the notes of the running version when the update check ran before this existed", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, UPDATE_CACHE_FILE), JSON.stringify({ latest: null, checkedAt: 1 }));

    expect(versionsOf(dir, "1.2.0")).toEqual(["1.2.0"]);
    expect(await seen(dir)).toBe("1.2.0");
  });

  it("should say nothing on a downgrade, and keep the highest version seen", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, LAST_SEEN_FILE), "1.2.0");

    expect(takeWhatsNew("1.1.0", dir, notes)).toBeNull();
    expect(await seen(dir)).toBe("1.2.0");
  });

  it("should store a version that has no notes, so that the next one shows only its own", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, LAST_SEEN_FILE), "1.2.0");

    expect(takeWhatsNew("1.2.1", dir, notes)).toBeNull();
    expect(await seen(dir)).toBe("1.2.1");
  });

  it("should say nothing for a build that is not a release", async () => {
    const dir = await tempDir();

    expect(takeWhatsNew("0.0.0-dev", dir, notes)).toBeNull();
    expect(await seen(dir)).toBeNull();
  });

  it("should never throw when the cache dir cannot be written", async () => {
    const dir = await tempDir();
    const blocker = join(dir, "file");
    await writeFile(blocker, "");

    expect(takeWhatsNew("1.2.0", join(blocker, "cache"), notes)).toBeNull();
    expect(() => markFirstRun("1.2.0", join(blocker, "cache"))).not.toThrow();
  });

  it("should not take a first install for an upgrade after a run that showed nothing", async () => {
    const dir = await tempDir();

    markFirstRun("1.2.0", dir);
    await writeFile(join(dir, UPDATE_CACHE_FILE), JSON.stringify({ latest: null, checkedAt: 1 }));

    expect(takeWhatsNew("1.3.0", dir, notes)).toBeNull();
    expect(takeWhatsNew("1.2.0", dir, notes)).toBeNull();
  });

  it("should leave a stored version alone in markFirstRun", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, LAST_SEEN_FILE), "1.0.0");

    markFirstRun("1.2.0", dir);

    expect(await seen(dir)).toBe("1.0.0");
  });
});

describe("newsOf", () => {
  const upgrade = () => ({ current: "1.2.0", from: "1.0.0", notes });

  it("should put what asks for an action first, then the info newest first", () => {
    const { lines, title } = newsOf(upgrade());

    expect(title).toBe("probe 1.2.0 (you had 1.0.0)");
    expect(lines).toEqual([
      { mark: "!", text: "second needs the new schema" },
      { mark: "+", text: "third" },
      { mark: "+", text: "second" },
      { mark: "+", text: "first" },
    ]);
  });

  it("should put the warnings about saved completion before the notes", () => {
    const { lines } = newsOf(upgrade(), ["Saved zsh completion is old"]);

    expect(lines[0]).toEqual({ mark: "!", text: "Saved zsh completion is old" });
  });

  it("should not say what the version was when it is not known", () => {
    expect(newsOf({ ...upgrade(), from: null }).title).toBe("probe 1.2.0");
  });

  it("should cap the lines and count the others", () => {
    const many: ReleaseNotes = {
      version: "1.2.0",
      items: Array.from({ length: 12 }, (_, i) => ({ kind: "info" as const, text: `item ${i}` })),
    };

    const { lines } = newsOf({ current: "1.2.0", from: "1.1.0", notes: [many] });

    expect(lines).toHaveLength(MAX_NEWS_LINES);
    expect(lines.at(-1)).toEqual({ mark: "+", text: "5 more" });
  });

  it("should keep the warnings when the cap cuts the info", () => {
    const many: ReleaseNotes = {
      version: "1.2.0",
      items: Array.from({ length: 12 }, (_, i) => ({ kind: "info" as const, text: `item ${i}` })),
    };

    const { lines } = newsOf({ current: "1.2.0", from: "1.1.0", notes: [many] }, ["old script"]);

    expect(lines[0]?.mark).toBe("!");
  });
});

describe("renderNews", () => {
  const news = newsOf({ current: "1.2.0", from: "1.1.0", notes });

  it("should lay out the title, the lines indented and the link, without color", () => {
    expect(renderNews(news, false).split("\n")).toEqual([
      "probe 1.2.0 (you had 1.1.0)",
      "  ! second needs the new schema",
      "  + third",
      "  + second",
      "  + first",
      `  All notes: ${RELEASES_URL}`,
    ]);
  });

  it("should color the marks when asked", () => {
    expect(renderNews(news, true)).toContain("\u001b[33m!\u001b[39m");
  });
});

describe("currentNotes", () => {
  it("should give the notes of the newest version not above the running one", () => {
    expect(currentNotes("1.1.5", notes)?.notes.map(({ version }) => version)).toEqual(["1.1.0"]);
    expect(currentNotes("0.5.0", notes)).toBeNull();
  });
});

describe("the completion marker", () => {
  const SCRIPTS = {
    zsh: zshScript,
    bash: bashScript,
    fish: fishScript,
    powershell: powershellScript,
  };

  it.each(Object.keys(SCRIPTS))("should be in the head of the %s script", (shell) => {
    const script = SCRIPTS[shell as keyof typeof SCRIPTS]([], "3.4.5");

    expect(markerVersion(script)).toBe("3.4.5");
  });

  it("should keep #compdef first in the zsh script", () => {
    expect(zshScript([], "1.2.0").split("\n")[0]).toBe("#compdef probe");
  });

  it("should round trip, and say nothing of a script without it", () => {
    expect(markerVersion(`# x\n${completionMarker("1.0.0")}\n`)).toBe("1.0.0");
    expect(markerVersion("# a\n# b\n")).toBeUndefined();
  });
});

describe("saved completion scripts", () => {
  const setup = async () => {
    const home = await tempDir();
    const where = { home, env: {} };
    const save = async (shell: "zsh" | "fish" | "bash", text: string) => {
      const place = completionPlaces(where).find((one) => one.shell === shell);
      const path = place?.path ?? "";
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, text);
    };
    return { home, where, save };
  };

  it("should say nothing when nothing is saved", async () => {
    const { where } = await setup();

    expect(staleCompletions("1.2.0", where)).toEqual([]);
  });

  it("should name the right command and path for each shell", async () => {
    const { where, save } = await setup();
    await save("zsh", "#compdef probe\n# probe completion 1.1.0\n");
    await save("fish", "# probe completion 1.0.0\n");
    await save("bash", "# no marker\n");

    expect(staleCompletions("1.2.0", where)).toEqual([
      "Saved zsh completion is from 1.1.0: run `probe completion zsh > ~/.zfunc/_probe`",
      "Saved fish completion is from 1.0.0: run `probe completion fish > ~/.config/fish/completions/probe.fish`",
      "Saved bash completion is from an older probe: run `probe completion bash > ~/.local/share/bash-completion/completions/probe`",
    ]);
  });

  it("should leave a fresh script alone", async () => {
    const { where, save } = await setup();
    await save("zsh", zshScript([], "1.2.0"));
    await save("fish", fishScript([], "1.3.0"));

    expect(staleCompletions("1.2.0", where)).toEqual([]);
  });

  it("should follow XDG_CONFIG_HOME and XDG_DATA_HOME", async () => {
    const home = await tempDir();
    const where = { home, env: { XDG_CONFIG_HOME: "/xdg/config", XDG_DATA_HOME: "/xdg/data" } };

    expect(completionPlaces(where).map(({ path }) => path)).toEqual([
      join(home, ".zfunc", "_probe"),
      join("/xdg/config", "fish", "completions", "probe.fish"),
      join("/xdg/data", "bash-completion", "completions", "probe"),
    ]);
  });

  it("should only read the head of a script", async () => {
    const { where, save } = await setup();
    await save("zsh", `#compdef probe\n${"# filler\n".repeat(200)}# probe completion 1.0.0\n`);

    expect(staleCompletions("1.2.0", where)).toEqual([
      "Saved zsh completion is from an older probe: run `probe completion zsh > ~/.zfunc/_probe`",
    ]);
  });
});

describe("whatsNewNotice", () => {
  it("should join the notes and the warning about a stale saved script", async () => {
    const dir = await tempDir();
    const home = await tempDir();
    await mkdir(join(home, ".zfunc"));
    await writeFile(join(home, ".zfunc", "_probe"), "#compdef probe\n");
    await writeFile(join(dir, LAST_SEEN_FILE), "1.0.0");

    const text = whatsNewNotice("1.1.0", dir, false, { home, env: {} });

    const lines = text?.split("\n") ?? [];
    expect(lines[0]).toBe("probe 1.1.0 (you had 1.0.0)");
    expect(lines[1]).toContain("! Saved zsh completion is from an older probe");
    expect(lines.at(-1)).toContain(RELEASES_URL);
    expect(whatsNewNotice("1.1.0", dir, false, { home, env: {} })).toBeNull();
  });
});
