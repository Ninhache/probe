import { describe, expect, it } from "vitest";
import { configSchemaV1 } from "../src/config/schema";
import { type ActionDeps, serviceActions } from "../src/dashboard/actions";

const config = configSchemaV1.parse({
  schemaVersion: 1,
  services: { api: { port: 3000, path: "/health" } },
});
const URL = "http://localhost:3000/health";

function deps(works: boolean, over: Partial<ActionDeps> = {}) {
  const seen: string[] = [];
  const act = async (text: string) => {
    seen.push(text);
    return works;
  };
  return {
    seen,
    deps: { platform: "linux", env: {}, openUrl: act, copyText: act, ...over } as ActionDeps,
  };
}

describe("serviceActions", () => {
  it("should open the URL of the service and say so", async () => {
    const { seen, deps: system } = deps(true);

    expect(await serviceActions(() => config, system).onOpen("api")).toBe(`Opened ${URL}`);
    expect(seen).toEqual([URL]);
  });

  it("should give the URL alone on a line when the opener is missing", async () => {
    const { deps: system } = deps(false);

    const said = await serviceActions(() => config, system).onOpen("api");

    expect(said.split("\n")).toEqual(["xdg-open not found. The URL:", URL]);
  });

  it("should copy the curl command and say so", async () => {
    const { seen, deps: system } = deps(true);

    const said = await serviceActions(() => config, system).onCopy("api", undefined);

    expect(seen).toEqual([`curl -i -L --max-time 3 '${URL}'`]);
    expect(said).toBe(`Copied: ${seen[0]}`);
  });

  it("should give the command alone on a line when no clipboard tool works", async () => {
    const { seen, deps: system } = deps(false, { env: { WAYLAND_DISPLAY: "wayland-1" } });

    const said = await serviceActions(() => config, system).onCopy("api", undefined);

    expect(said.split("\n")).toEqual(["No wl-copy or xclip to copy with. The command:", seen[0]]);
  });

  it("should name pbcopy when on macOS", async () => {
    const { deps: system } = deps(false, { platform: "darwin" });

    expect(await serviceActions(() => config, system).onCopy("api", undefined)).toContain(
      "No pbcopy ",
    );
  });

  it("should say so when the service is gone, doing nothing", async () => {
    const { seen, deps: system } = deps(true);
    const actions = serviceActions(() => config, system);

    expect(await actions.onOpen("gone")).toBe("gone is no longer in the config");
    expect(await actions.onCopy("gone", undefined)).toBe("gone is no longer in the config");
    expect(seen).toEqual([]);
  });

  it("should use the timeout the dashboard gives when the service has one there", async () => {
    const { seen, deps: system } = deps(true);

    await serviceActions(() => config, system).onCopy("api", 10);

    expect(seen[0]).toContain("--max-time 10 ");
  });
});
