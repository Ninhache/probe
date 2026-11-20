import { describe, expect, it } from "vitest";
import { commandForm } from "../src/checkers/command-form";
import {
  emptyForm,
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
    expect(adding.map(({ key }) => key)).toEqual(["name", "address", "expect", "method"]);
    expect(formRows(false).map(({ key }) => key)).toEqual(["address", "expect", "method"]);
  });

  it("should read empty fields as the defaults", () => {
    expect(formFields({ ...emptyForm(), name: "api", address: "3000" })).toEqual({
      port: 3000,
      host: "localhost",
      path: "/",
      expect: undefined,
      method: undefined,
      headers: undefined,
    });
  });

  it("should read the method in capitals, and refuse one that is not a known verb", () => {
    const values = { ...emptyForm(), name: "api", address: "3000", method: "post" };

    expect(formFields(values).method).toBe("POST");
    expect(formProblem(adding, values, [])).toBeUndefined();
    expect(formProblem(adding, { ...values, method: "TRACE" }, [])).toEqual({
      row: 3,
      message: "One of GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    });
    expect(formValues({ ...formFields(values), method: "POST" }).method).toBe("POST");
  });

  it("should fill the form with what the service has and read it back unchanged", () => {
    const fields = { host: "127.0.0.1", port: 8080, path: "/health", expect: [200, 204] };

    expect(formValues(fields)).toEqual({
      name: "",
      address: "127.0.0.1:8080/health",
      expect: "200,204",
      method: "",
      headers: [],
    });
    expect(formFields(formValues(fields))).toMatchObject(fields);
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
    const values = { ...emptyForm(), address: "3000", headers: ["  ", "Accept: text/plain"] };

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
    const values = { ...emptyForm(), name: "web", address: "3000", headers: ["Accept: a", line] };

    const problem = formProblem(adding, { ...values, headers: ["X-One: 1", line] }, []);

    expect(problem?.row).toBe(adding.length + 1);
    expect(problem?.message).toContain(message);
  });

  it("should refuse the same header twice, whatever the case", () => {
    const values = { ...emptyForm(), address: "3000", headers: ["Accept: a", "", "accept: b"] };

    expect(formProblem(formRows(false), values, [])).toEqual({
      row: formRows(false).length + 2,
      message: "accept is given twice",
      line: { kind: "headers", index: 2 },
    });
  });

  it("should never repeat a value in what it refuses", () => {
    const values = { ...emptyForm(), address: "3000", headers: [`X-Token: ${SECRET}\u0007`] };

    expect(formProblem(formRows(false), values, [])?.message).not.toContain(SECRET);
  });

  it("should find the secret typed in clear, its scheme set apart", () => {
    const headers = [
      "Accept: text/plain",
      `Authorization: Bearer ${SECRET}`,
      `X-Api-Key: ${SECRET}`,
    ];
    const values = { ...emptyForm(), address: "3000", headers };

    expect(formProblem(formRows(false), values, [])).toBeUndefined();
    const found = formSecret(values);
    expect(found).toEqual({
      kind: "headers",
      index: 1,
      header: "Authorization",
      scheme: "Bearer ",
      secret: SECRET,
    });

    const next = withVariable(values, found as NonNullable<typeof found>, "API_TOKEN");
    expect(next.headers[1]).toBe("Authorization: Bearer $" + "{API_TOKEN}");
    expect(formSecret(next)).toMatchObject({ index: 2, header: "X-Api-Key", scheme: "" });
  });

  it("should find no secret in a reference or in an ordinary header", () => {
    const headers = [`Authorization: Bearer ${REFERENCE}`, "Accept: text/plain"];

    expect(formSecret({ ...emptyForm(), headers })).toBeUndefined();
  });

  it.each([
    [{ name: "my api", address: "3000" }, 0],
    [{ name: "api", address: "3000" }, 0],
    [{ name: "web", address: "" }, 1],
    [{ name: "web", address: "70000" }, 1],
    [{ name: "web", address: "a b:3000" }, 1],
    [{ name: "web", address: "ftp://example.com" }, 1],
    [{ name: "web", address: "3000", expect: "ok" }, 2],
    [{ name: "web", address: "3000", expect: "999" }, 2],
  ])("should refuse %o at row %i", (typed, row) => {
    expect(formProblem(adding, { ...emptyForm(), ...typed }, ["api"])?.row).toBe(row);
  });

  it("should accept a name and a port alone", () => {
    expect(
      formProblem(adding, { ...emptyForm(), name: "web", address: "3000" }, ["api"]),
    ).toBeUndefined();
  });

  it("should not look at the name when editing", () => {
    expect(
      formProblem(formRows(false), { ...emptyForm(), address: "3000" }, ["api"]),
    ).toBeUndefined();
  });
});

describe("service form of a command", () => {
  const rows = formRows(false, commandForm);
  const typed = (env: string[]) => ({ ...emptyForm(commandForm), command: "mysqladmin ping", env });

  it("should read the env as NAME=value lines and write it back", () => {
    const env = { MYSQL_HOST: "db", DATABASE_URL: "postgres://db/app?mode=ro" };

    const values = formValues({ command: "mysqladmin ping", env }, commandForm);

    expect(values.env).toEqual(["MYSQL_HOST=db", "DATABASE_URL=postgres://db/app?mode=ro"]);
    expect(formFields(values, commandForm).env).toEqual(env);
  });

  it("should write no env when no line is typed", () => {
    expect(formFields(typed(["  "]), commandForm).env).toBeUndefined();
  });

  it("should keep an http form free of env", () => {
    expect(formValues({ port: 3000, env: { A: "b" } }).env).toBeUndefined();
    expect(formFields({ ...emptyForm(), address: "3000", env: ["A=b"] }).env).toBeUndefined();
  });

  it.each([
    [["no equal sign"], "A variable as NAME=value"],
    [["1BAD=x"], "Expects a name of letters, digits and _"],
    [["A=1", "A=2"], "A is given twice"],
    [["MYSQL_PWD=${not valid}"], "MYSQL_PWD expects a variable name between braces"],
  ])("should refuse the lines %j", (env, message) => {
    const problem = formProblem(rows, typed(env), [], commandForm);

    expect(problem?.message).toContain(message);
    expect(problem?.line).toEqual({ kind: "env", index: env.length - 1 });
  });

  it("should find the secret typed in an env line, and give it a reference", () => {
    const values = typed(["MYSQL_HOST=db", `MYSQL_PWD=${SECRET}`]);

    expect(formProblem(rows, values, [], commandForm)).toBeUndefined();
    const found = formSecret(values);
    expect(found).toEqual({
      kind: "env",
      index: 1,
      header: "MYSQL_PWD",
      scheme: "",
      secret: SECRET,
    });
    const next = withVariable(values, found as NonNullable<typeof found>, "DB_PASSWORD");
    expect(next.env?.[1]).toBe("MYSQL_PWD=$" + "{DB_PASSWORD}");
    expect(formSecret(next)).toBeUndefined();
  });
});
