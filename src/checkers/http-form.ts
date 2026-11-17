import { DEFAULT_METHOD, METHODS, type Method } from "../config/schema";
import {
  addressFields,
  addressProblem,
  addressText,
  expectProblem,
  methodProblem,
  parseExpectList,
} from "../config/service-input";
import type { ServiceForm } from "./types";

const problems: Readonly<Record<string, (value: string) => string | undefined>> = {
  address: addressProblem,
  expect: (value) => (value ? expectProblem(value) : undefined),
  method: (value) => (value ? methodProblem(value) : undefined),
};

export const httpForm: ServiceForm = {
  fields: [
    { key: "address", label: "Address", placeholder: "localhost:3000/health" },
    { key: "expect", label: "Expect", placeholder: "any 2xx" },
    { key: "method", label: "Method", placeholder: DEFAULT_METHOD, choices: METHODS },
  ],
  headers: true,
  replacedByUrl: new Set(["address"]),
  read: ({ url, host, port, path, expect, method }) => ({
    address: addressText({ url, host, port, path }),
    expect: [expect ?? []].flat().join(","),
    method: method ?? "",
  }),
  problem: (key, value) => problems[key]?.(value),
  written: (values) => ({
    ...addressFields(values.address ?? ""),
    expect: values.expect ? parseExpectList(values.expect) : undefined,
    method: values.method ? (values.method.toUpperCase() as Method) : undefined,
  }),
};
