import { commandFromText, commandProblem, commandText } from "../config/service-input";
import type { ServiceForm } from "./types";

export const commandForm: ServiceForm = {
  env: true,
  fields: [{ key: "command", label: "Command", placeholder: "redis-cli ping" }],
  read: ({ command }) => ({ command: command === undefined ? "" : commandText(command) }),
  problem: (key, value) => (key === "command" ? commandProblem(value) : undefined),
  written: (values) => ({ type: "command", command: commandFromText(values.command ?? "") }),
};
