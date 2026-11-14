import { describe, expect, it } from "vitest";
import { createSaveQueue } from "../src/dashboard/saves";

describe("createSaveQueue", () => {
  it("reports nothing when the save went through", async () => {
    const saves = createSaveQueue();

    expect(await saves.save("local.yml", async () => true, "refused")).toBeUndefined();
    expect(saves.failures()).toEqual([]);
  });

  it("reports the refusal when the file was left alone", async () => {
    const saves = createSaveQueue();

    expect(await saves.save("local.yml", async () => false, "refused")).toBe("refused");
    expect(saves.failures()).toEqual(["refused"]);
  });

  it("reports the first line of the error when the write throws, and keeps going", async () => {
    const saves = createSaveQueue();
    const failing = saves.save(
      "config.yml",
      async () => {
        throw new Error("config.yml is invalid:\n  - services.api.port: too big");
      },
      "refused",
    );
    const next = saves.save("local.yml", async () => true, "refused");

    expect(await failing).toBe("config.yml is invalid:");
    expect(await next).toBe("config.yml is invalid:");
    expect(saves.failures()).toEqual(["config.yml is invalid:"]);
  });

  it("names the file and the system error code when the file cannot be written", async () => {
    const saves = createSaveQueue();

    const failure = await saves.save(
      ".probe/config.yml",
      async () => {
        throw Object.assign(new Error("EACCES: permission denied, open '/a/long/path'"), {
          code: "EACCES",
        });
      },
      "refused",
    );

    expect(failure).toBe(".probe/config.yml cannot be written (EACCES)");
  });

  it("forgets the failure of a file once a later save of it succeeds", async () => {
    const saves = createSaveQueue();
    await saves.save("local.yml", async () => false, "refused");

    expect(await saves.save("local.yml", async () => true, "refused")).toBeUndefined();
    expect(saves.failures()).toEqual([]);
  });

  it("runs the saves one at a time, in order", async () => {
    const saves = createSaveQueue();
    const order: string[] = [];
    void saves.save(
      "a",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push("first");
        return true;
      },
      "refused",
    );
    void saves.save(
      "a",
      async () => {
        order.push("second");
        return true;
      },
      "refused",
    );

    await saves.idle();

    expect(order).toEqual(["first", "second"]);
  });
});
