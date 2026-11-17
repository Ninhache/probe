import { describe, expect, it } from "vitest";
import { EMPTY_PARAMETER_FORM, nextKind, parameterExample } from "../src/dashboard/parameter-form";

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
      "e.g. urls: { globex: globex.example.com }",
    );
  });
});

describe("nextKind", () => {
  it("should go round the ways of sending", () => {
    expect(nextKind("url", 1)).toBe("query");
    expect(nextKind("query", -1)).toBe("url");
  });

  it("should take the way a letter starts, and keep the current one for another letter", () => {
    expect(nextKind("query", "h")).toBe("header");
    expect(nextKind("query", "z")).toBe("query");
  });
});
