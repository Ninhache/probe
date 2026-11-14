import { describe, expect, it } from "vitest";
import { EMPTY_FORM, formFields, formProblem, formRows, formValues } from "../src/dashboard/form";

const adding = formRows(true);

describe("service form", () => {
  it("should ask for the name only when adding", () => {
    expect(adding.map(({ key }) => key)).toEqual(["name", "port", "host", "path", "expect"]);
    expect(formRows(false).map(({ key }) => key)).toEqual(["port", "host", "path", "expect"]);
  });

  it("should read empty fields as the defaults", () => {
    expect(formFields({ ...EMPTY_FORM, name: "api", port: "3000" })).toEqual({
      port: 3000,
      host: "localhost",
      path: "/",
      expect: undefined,
    });
  });

  it("should fill the form with what the service has and read it back unchanged", () => {
    const fields = { host: "127.0.0.1", port: 8080, path: "/health", expect: [200, 204] };

    expect(formValues(fields)).toEqual({
      name: "",
      port: "8080",
      host: "127.0.0.1",
      path: "/health",
      expect: "200,204",
    });
    expect(formFields(formValues(fields))).toEqual(fields);
  });

  it.each([
    [{ name: "my api", port: "3000" }, 0],
    [{ name: "api", port: "3000" }, 0],
    [{ name: "web", port: "" }, 1],
    [{ name: "web", port: "70000" }, 1],
    [{ name: "web", port: "3000", host: "a b" }, 2],
    [{ name: "web", port: "3000", path: "health" }, 3],
    [{ name: "web", port: "3000", expect: "ok" }, 4],
    [{ name: "web", port: "3000", expect: "999" }, 4],
  ])("should refuse %o at row %i", (typed, row) => {
    expect(formProblem(adding, { ...EMPTY_FORM, ...typed }, ["api"])?.row).toBe(row);
  });

  it("should accept a name and a port alone", () => {
    expect(
      formProblem(adding, { ...EMPTY_FORM, name: "web", port: "3000" }, ["api"]),
    ).toBeUndefined();
  });

  it("should not look at the name when editing", () => {
    expect(formProblem(formRows(false), { ...EMPTY_FORM, port: "3000" }, ["api"])).toBeUndefined();
  });
});
