import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUndoJournal, type JournalFile, journalFiles } from "../src/dashboard/undo";
import { tempProject } from "./helpers";

describe("createUndoJournal", () => {
  let dir: string;
  let config: JournalFile;
  let makefile: JournalFile;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "probe-undo-"));
    config = { path: join(dir, "config.yml"), label: ".probe/config.yml" };
    makefile = { path: join(dir, "Makefile"), label: "Makefile" };
    await writeFile(config.path, "v1\n");
    await writeFile(makefile.path, "m1\n");
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  const write = (file: JournalFile, text: string) => async () => {
    await writeFile(file.path, text);
    return true;
  };

  it("should put back every file the last write changed", async () => {
    const journal = createUndoJournal([config, makefile]);
    await journal.record("add web", async () => {
      await writeFile(config.path, "v2\n");
      await writeFile(makefile.path, "m2\n");
      return true;
    });

    const outcome = await journal.undo();

    expect(outcome).toEqual({ kind: "undone", label: "add web" });
    expect(await readFile(config.path, "utf8")).toBe("v1\n");
    expect(await readFile(makefile.path, "utf8")).toBe("m1\n");
  });

  it("should undo the writes from the last one back", async () => {
    const journal = createUndoJournal([config]);
    await journal.record("first", write(config, "v2\n"));
    await journal.record("second", write(config, "v3\n"));

    expect(await journal.undo()).toEqual({ kind: "undone", label: "second" });
    expect(await journal.undo()).toEqual({ kind: "undone", label: "first" });
    expect(await readFile(config.path, "utf8")).toBe("v1\n");
    expect(await journal.undo()).toEqual({ kind: "empty" });
  });

  it("should write again on redo what undo took back", async () => {
    const journal = createUndoJournal([config, makefile]);
    await journal.record("add web", async () => {
      await writeFile(config.path, "v2\n");
      await writeFile(makefile.path, "m2\n");
      return true;
    });
    await journal.undo();

    const outcome = await journal.redo();

    expect(outcome).toEqual({ kind: "undone", label: "add web" });
    expect(await readFile(config.path, "utf8")).toBe("v2\n");
    expect(await readFile(makefile.path, "utf8")).toBe("m2\n");
    expect(await journal.undo()).toEqual({ kind: "undone", label: "add web" });
  });

  it("should have nothing to redo once a new write is recorded", async () => {
    const journal = createUndoJournal([config]);
    await journal.record("first", write(config, "v2\n"));
    await journal.undo();

    await journal.record("second", write(config, "v3\n"));

    expect(await journal.redo()).toEqual({ kind: "empty" });
  });

  it("should redo nothing when a file changed since the undo", async () => {
    const journal = createUndoJournal([config]);
    await journal.record("add web", write(config, "v2\n"));
    await journal.undo();
    await writeFile(config.path, "by hand\n");

    const outcome = await journal.redo();

    expect(outcome).toEqual({ kind: "changed", file: ".probe/config.yml" });
    expect(await readFile(config.path, "utf8")).toBe("by hand\n");
  });

  it("should touch nothing when a file changed since the write", async () => {
    const journal = createUndoJournal([config, makefile]);
    await journal.record("add web", async () => {
      await writeFile(config.path, "v2\n");
      await writeFile(makefile.path, "m2\n");
      return true;
    });
    await writeFile(makefile.path, "by hand\n");

    const outcome = await journal.undo();

    expect(outcome).toEqual({ kind: "changed", file: "Makefile" });
    expect(await readFile(config.path, "utf8")).toBe("v2\n");
    expect(await readFile(makefile.path, "utf8")).toBe("by hand\n");
  });

  it("should keep the step refused, to undo once the file is put back", async () => {
    const journal = createUndoJournal([config]);
    await journal.record("add web", write(config, "v2\n"));
    await writeFile(config.path, "by hand\n");
    await journal.undo();
    await writeFile(config.path, "v2\n");

    expect(await journal.undo()).toEqual({ kind: "undone", label: "add web" });
  });

  it("should record nothing when the write is refused", async () => {
    const journal = createUndoJournal([config]);

    await journal.record("add web", async () => false);

    expect(await journal.undo()).toEqual({ kind: "empty" });
  });

  it("should record nothing when the write changed no file", async () => {
    const journal = createUndoJournal([config]);

    await journal.record("edit api", write(config, "v1\n"));

    expect(await journal.undo()).toEqual({ kind: "empty" });
  });

  it("should leave in place a file the write created", async () => {
    const lock = { path: join(dir, "lock.yml"), label: ".probe/lock.yml" };
    const journal = createUndoJournal([config, lock]);
    await journal.record("add web", async () => {
      await writeFile(config.path, "v2\n");
      await writeFile(lock.path, "l1\n");
      return true;
    });

    await journal.undo();

    expect(await readFile(config.path, "utf8")).toBe("v1\n");
    expect(await readFile(lock.path, "utf8")).toBe("l1\n");
  });

  it("should restore a file the write deleted, and delete it again on redo", async () => {
    const env = { path: join(dir, "prod.yml"), label: ".probe/envs/prod.yml" };
    await writeFile(env.path, "services: {}\n");
    const journal = createUndoJournal([config]);

    await journal.record("remove environment prod", async () => {
      await rm(env.path);
      return true;
    }, [env]);
    await expect(readFile(env.path, "utf8")).rejects.toThrow();

    expect(await journal.undo()).toEqual({ kind: "undone", label: "remove environment prod" });
    expect(await readFile(env.path, "utf8")).toBe("services: {}\n");
    expect(await readFile(config.path, "utf8")).toBe("v1\n");

    await journal.redo();
    await expect(readFile(env.path, "utf8")).rejects.toThrow();
  });

  it("should refuse to undo a deletion when the file was written back since", async () => {
    const env = { path: join(dir, "prod.yml"), label: ".probe/envs/prod.yml" };
    await writeFile(env.path, "a\n");
    const journal = createUndoJournal([config]);
    await journal.record("remove environment prod", async () => {
      await rm(env.path);
      return true;
    }, [env]);
    await writeFile(env.path, "other\n");

    expect(await journal.undo()).toEqual({ kind: "changed", file: ".probe/envs/prod.yml" });
    expect(await readFile(env.path, "utf8")).toBe("other\n");
  });

  it("should forget the oldest write past its limit", async () => {
    const journal = createUndoJournal([config], 2);
    for (const text of ["v2\n", "v3\n", "v4\n"]) await journal.record(text, write(config, text));

    await journal.undo();
    await journal.undo();

    expect(await journal.undo()).toEqual({ kind: "empty" });
    expect(await readFile(config.path, "utf8")).toBe("v2\n");
  });

  it("should never keep local.yml, which holds secret values", async () => {
    const paths = await tempProject("schemaVersion: 1\nservices: {}\n");

    const kept = journalFiles(paths).map(({ path }) => path);

    expect(kept).toContain(paths.config);
    expect(kept).not.toContain(paths.local);
  });
});
