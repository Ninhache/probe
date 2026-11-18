import { describe, expect, it } from "vitest";
import {
  addressChanges,
  addressRows,
  EMPTY_PARAMETER_FORM,
  parameterExample,
  withScheme,
} from "../src/dashboard/parameter-form";

describe("parameterExample", () => {
  const form = { ...EMPTY_PARAMETER_FORM, values: "globex, acme" };

  it("should show the query a value adds, named after the parameter by default", () => {
    expect(parameterExample(form, "tenant")).toEqual([
      "Adds ?name=value to every URL.",
      "e.g. localhost:3000/health?tenant=globex",
    ]);
  });

  it("should encode in the example what a URL cannot carry", () => {
    const spaced = { ...form, values: "new york" };

    expect(parameterExample(spaced, "city")[1]).toBe("e.g. localhost:3000/health?city=new%20york");
    expect(parameterExample({ ...spaced, strategy: "path" }, "city")[1]).toBe(
      "e.g. localhost:3000/new%20york/health",
    );
  });

  it("should show the value in front of the path", () => {
    expect(parameterExample({ ...form, strategy: "path" }, "tenant")[1]).toBe(
      "e.g. localhost:3000/globex/health",
    );
  });

  it("should show the header a value is sent in", () => {
    const header = { ...form, strategy: "header", strategyName: "X-Team" };

    expect(parameterExample(header, "tenant")[1]).toBe("e.g. X-Team: globex");
  });

  it("should show the address a service lists for a value", () => {
    expect(parameterExample({ ...form, strategy: "url" }, "env")[1]).toBe(
      "e.g. urls: { globex: https://globex.example.com }",
    );
  });
});

describe("withScheme", () => {
  it.each([
    ["localhost:3000", "http://localhost:3000"],
    ["127.0.0.1:3000/health", "http://127.0.0.1:3000/health"],
    ["https://example.com", "https://example.com"],
    ["  ", ""],
  ])("should make %j %j", (typed, written) => {
    expect(withScheme(typed)).toBe(written);
  });
});

describe("address lines", () => {
  const URL_FORM = { name: "env", values: "dev, prod", strategy: "url", strategyName: "" };

  it("should give a line per service and value only for a url parameter", () => {
    expect(addressRows(URL_FORM, ["api", "db"])).toHaveLength(4);
    expect(addressRows({ ...URL_FORM, strategy: "query" }, ["api"])).toEqual([]);
  });

  it("should send only the lines changed, with their scheme", () => {
    const rows = addressRows(URL_FORM, ["api"]);
    const initial = { api: { prod: "https://example.com" } };

    const changes = addressChanges(
      rows,
      { api: { dev: "localhost:3001", prod: "https://example.com" } },
      initial,
    );

    expect(changes).toEqual({ api: { dev: "http://localhost:3001" } });
  });
});
