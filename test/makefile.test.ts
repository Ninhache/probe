import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readLock } from "../src/config/lock";
import type { Config } from "../src/config/schema";
import {
  BLOCK_END,
  BLOCK_START,
  extractBlock,
  hashBlock,
  renderBlock,
  replaceBlock,
} from "../src/makefile/generator";
import { blockState, makefilePath, syncMakefile } from "../src/makefile/sync";
import { tempProject } from "./helpers";

const config = (...names: string[]): Config => ({
  schemaVersion: 1,
  services: Object.fromEntries(
    names.map((name, index) => [name, { host: "localhost", port: 3000 + index, path: "/" }]),
  ),
});

const HAND_WRITTEN_BEFORE = "SHELL := /bin/sh\n\nbuild: ## Build the app\n\tnpm run build\n";
const HAND_WRITTEN_AFTER = "\ndeploy: build ## Ship it\n\t./deploy.sh\n";

describe("renderBlock", () => {
  const block = renderBlock(["api", "front"]);

  it("is delimited by the markers", () => {
    expect(block.startsWith(`${BLOCK_START}\n`)).toBe(true);
    expect(block.endsWith(`\n${BLOCK_END}`)).toBe(true);
  });

  it("has one check target per service", () => {
    expect(block).toContain("check-api: ## Check api\n\t@$(PROBE) check api\n");
    expect(block).toContain("check-front: ## Check front\n\t@$(PROBE) check front\n");
    expect(block).toContain(".PHONY: help check status probe check-api check-front\n");
  });

  it("has a target that opens the dashboard", () => {
    expect(block).toContain("probe: ## Open the dashboard\n\t@$(PROBE)\n");
  });

  it("prefers the probe binary and falls back to npx with the scoped name", () => {
    expect(block).toContain(
      'PROBE ?= $(shell command -v probe >/dev/null 2>&1 && echo probe || echo "npx -y @ninhache/probe@latest")',
    );
    expect(block).not.toMatch(/npx (-y )?probe\b/);
  });

  it("indents every recipe with a tab", () => {
    const recipes = block.split("\n").filter((line) => line.includes("@"));
    expect(recipes.filter((line) => !line.startsWith("PROBE"))).toSatisfy((lines: string[]) =>
      lines.every((line) => line.startsWith("\t")),
    );
  });

  it("uses nothing newer than GNU Make 3.81 or outside POSIX sh", () => {
    for (const forbidden of [
      ".ONESHELL",
      "$(file",
      ".RECIPEPREFIX",
      "::=",
      "!=",
      "&:",
      "sed -i",
      "grep -P",
      "[[",
    ]) {
      expect(block).not.toContain(forbidden);
    }
  });

  it("is deterministic", () => {
    expect(renderBlock(["api", "front"])).toBe(block);
    expect(hashBlock(block)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("replaceBlock", () => {
  const block = renderBlock(["api"]);

  it("creates the content when there is no Makefile", () => {
    expect(replaceBlock(null, block)).toBe(`${block}\n`);
  });

  it("appends the block to a Makefile that has none", () => {
    expect(replaceBlock(HAND_WRITTEN_BEFORE, block)).toBe(`${HAND_WRITTEN_BEFORE}\n${block}\n`);
  });

  it("replaces only the block and keeps hand-written targets byte for byte", () => {
    const original = `${HAND_WRITTEN_BEFORE}\n${block}\n${HAND_WRITTEN_AFTER}`;
    const next = renderBlock(["api", "front"]);

    const result = replaceBlock(original, next);

    expect(result).toBe(`${HAND_WRITTEN_BEFORE}\n${next}\n${HAND_WRITTEN_AFTER}`);
    expect(extractBlock(result)).toBe(next);
  });

  it("finds a block whose start marker was worded by another version", () => {
    const old = `# >>> probe (généré — ne pas éditer)\nold stuff\n${BLOCK_END}`;
    expect(replaceBlock(`a:\n\n${old}\n\nb:\n`, block)).toBe(`a:\n\n${block}\n\nb:\n`);
  });

  it("refuses a block with no end marker instead of guessing", () => {
    expect(() => replaceBlock(`${BLOCK_START}\ncheck:\n`, block)).toThrowError(/no "# <<< probe"/);
  });
});

describe("syncMakefile", () => {
  it("creates the Makefile and the lock", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices: {}\n");

    const result = await syncMakefile(paths, config("api"), "1.2.3");

    const block = renderBlock(["api"]);
    expect(result).toEqual({ created: true, changed: true, hash: hashBlock(block) });
    expect(await readFile(makefilePath(paths), "utf8")).toBe(`${block}\n`);
    expect(await readLock(paths)).toEqual({
      cliVersion: "1.2.3",
      makefile: { hash: hashBlock(block) },
    });
  });

  it("preserves hand-written targets around the block", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices: {}\n");
    await writeFile(makefilePath(paths), HAND_WRITTEN_BEFORE);
    await syncMakefile(paths, config("api"));
    const withBlock = await readFile(makefilePath(paths), "utf8");
    await writeFile(makefilePath(paths), withBlock + HAND_WRITTEN_AFTER);

    await syncMakefile(paths, config("api", "front"));

    const makefile = await readFile(makefilePath(paths), "utf8");
    expect(makefile.startsWith(`${HAND_WRITTEN_BEFORE}\n${BLOCK_START}`)).toBe(true);
    expect(makefile.endsWith(`${BLOCK_END}\n${HAND_WRITTEN_AFTER}`)).toBe(true);
    expect(makefile).toContain("check-front:");
  });

  it("is idempotent and leaves the lock alone when nothing changed", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices: {}\n");
    await syncMakefile(paths, config("api"), "1.0.0");
    const makefile = await readFile(makefilePath(paths), "utf8");

    const second = await syncMakefile(paths, config("api"), "2.0.0");

    expect(second).toMatchObject({ created: false, changed: false });
    expect(await readFile(makefilePath(paths), "utf8")).toBe(makefile);
    expect((await readLock(paths))?.cliVersion).toBe("1.0.0");
  });
});

describe("blockState", () => {
  it("is missing without a Makefile or without a block", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices: {}\n");
    expect(await blockState(paths, config("api"))).toBe("missing");

    await writeFile(makefilePath(paths), HAND_WRITTEN_BEFORE);
    expect(await blockState(paths, config("api"))).toBe("missing");
  });

  it("is in-sync right after a sync", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices: {}\n");
    await syncMakefile(paths, config("api"));
    expect(await blockState(paths, config("api"))).toBe("in-sync");
  });

  it("is outdated when the config changed since the last sync", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices: {}\n");
    await syncMakefile(paths, config("api"));
    expect(await blockState(paths, config("api", "front"))).toBe("outdated");
  });

  it("is modified when the block was edited by hand", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices: {}\n");
    await syncMakefile(paths, config("api"));
    const makefile = await readFile(makefilePath(paths), "utf8");
    await writeFile(makefilePath(paths), makefile.replace("@$(PROBE) check api", "@echo hacked"));

    expect(await blockState(paths, config("api"))).toBe("modified");
  });

  it("ignores edits outside the block", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices: {}\n");
    await syncMakefile(paths, config("api"));
    const makefile = await readFile(makefilePath(paths), "utf8");
    await writeFile(makefilePath(paths), HAND_WRITTEN_BEFORE + makefile + HAND_WRITTEN_AFTER);

    expect(await blockState(paths, config("api"))).toBe("in-sync");
  });
});
