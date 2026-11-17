import { DEFAULT_METHOD, METHODS, type Method } from "../config/schema";
import {
  expectProblem,
  hostProblem,
  methodProblem,
  parseExpectList,
  pathProblem,
  portProblem,
} from "../config/service-input";
import type { ServiceForm } from "./types";

const problems: Readonly<Record<string, (value: string) => string | undefined>> = {
  port: portProblem,
  host: (value) => (value ? hostProblem(value) : undefined),
  path: (value) => (value ? pathProblem(value) : undefined),
  expect: (value) => (value ? expectProblem(value) : undefined),
  method: (value) => (value ? methodProblem(value) : undefined),
};

export const httpForm: ServiceForm = {
  fields: [
    { key: "port", label: "Port", placeholder: "3000" },
    { key: "host", label: "Host", placeholder: "localhost" },
    { key: "path", label: "Path", placeholder: "/" },
    { key: "expect", label: "Expect", placeholder: "any 2xx" },
    { key: "method", label: "Method", placeholder: DEFAULT_METHOD, choices: METHODS },
  ],
  headers: true,
  replacedByUrl: new Set(["port", "host", "path"]),
  read: ({ host, port, path, expect, method }) => ({
    port: String(port),
    host,
    path,
    expect: [expect ?? []].flat().join(","),
    method: method ?? "",
  }),
  problem: (key, value) => problems[key]?.(value),
  written: (values) => ({
    port: Number(values.port),
    host: values.host || "localhost",
    path: values.path || "/",
    expect: values.expect ? parseExpectList(values.expect) : undefined,
    method: values.method ? (values.method.toUpperCase() as Method) : undefined,
  }),
};
