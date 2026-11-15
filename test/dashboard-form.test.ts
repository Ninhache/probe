import { describe, expect, it } from "vitest";
import {
  EMPTY_FORM,
  formFields,
  formProblem,
  formRows,
  formSecret,
  formValues,
  withVariable,
} from "../src/dashboard/form";

const adding = formRows(true);
const REFERENCE = "$" + "{API_KEY}";
const SECRET = "s3cr3t-value";

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
      headers: [],
    });
    expect(formFields(formValues(fields))).toEqual(fields);
  });

  it("should write one line per header and read them back unchanged, in order", () => {
    const headers = { "X-Api-Key": REFERENCE, Accept: "text/plain" };
    const fields = { host: "localhost", port: 3000, path: "/", expect: undefined, headers };

    expect(formValues(fields).headers).toEqual([`X-Api-Key: ${REFERENCE}`, "Accept: text/plain"]);
    expect(Object.entries(formFields(formValues(fields)).headers ?? {})).toEqual(
      Object.entries(headers),
    );
  });

  it("should drop a header whose line was emptied", () => {
    const values = { ...EMPTY_FORM, port: "3000", headers: ["  ", "Accept: text/plain"] };

    expect(formFields(values).headers).toEqual({ Accept: "text/plain" });
    expect(formFields({ ...values, headers: [""] }).headers).toBeUndefined();
  });

  it.each([
    ["Accept", "A header as Name: value"],
    ["Bad name: x", "Expects a header name"],
    ["Content-Length: 3", "Expects a header a request without a body can carry"],
    ["Authorization:", "Authorization expects a value"],
    ["Accept: \u0007", "Accept expects a value on one line"],
  ])("should refuse the header %j", (line, message) => {
    const values = { ...EMPTY_FORM, name: "web", port: "3000", headers: ["Accept: a", line] };

    const problem = formProblem(adding, { ...values, headers: ["X-One: 1", line] }, []);

    expect(problem?.row).toBe(adding.length + 1);
    expect(problem?.message).toContain(message);
  });

  it("should refuse the same header twice, whatever the case", () => {
    const values = { ...EMPTY_FORM, port: "3000", headers: ["Accept: a", "", "accept: b"] };

    expect(formProblem(formRows(false), values, [])).toEqual({
      row: formRows(false).length + 2,
      message: "accept is given twice",
    });
  });

  it("should never repeat a value in what it refuses", () => {
    const values = { ...EMPTY_FORM, port: "3000", headers: [`X-Token: ${SECRET}\u0007`] };

    expect(formProblem(formRows(false), values, [])?.message).not.toContain(SECRET);
  });

  it("should find the secret typed in clear, its scheme set apart", () => {
    const headers = [
      "Accept: text/plain",
      `Authorization: Bearer ${SECRET}`,
      `X-Api-Key: ${SECRET}`,
    ];
    const values = { ...EMPTY_FORM, port: "3000", headers };

    expect(formProblem(formRows(false), values, [])).toBeUndefined();
    const found = formSecret(values);
    expect(found).toEqual({ index: 1, header: "Authorization", scheme: "Bearer ", secret: SECRET });

    const next = withVariable(values, found as NonNullable<typeof found>, "API_TOKEN");
    expect(next.headers[1]).toBe("Authorization: Bearer $" + "{API_TOKEN}");
    expect(formSecret(next)).toMatchObject({ index: 2, header: "X-Api-Key", scheme: "" });
  });

  it("should find no secret in a reference or in an ordinary header", () => {
    const headers = [`Authorization: Bearer ${REFERENCE}`, "Accept: text/plain"];

    expect(formSecret({ ...EMPTY_FORM, headers })).toBeUndefined();
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
