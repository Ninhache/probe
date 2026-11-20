import {
  commandFromText,
  commandFromWords,
  commandProblem,
  commandText,
  commandWordsProblem,
} from "../config/service-input";
import type { ServiceForm } from "./types";

export const commandForm: ServiceForm = {
  env: true,
  fields: [{ key: "command", label: "Command", placeholder: "redis-cli ping" }],
  read: ({ command }) => ({ command: command === undefined ? "" : commandText(command) }),
  problem: (key, value) => (key === "command" ? commandProblem(value) : undefined),
  written: (values) => ({ type: "command", command: commandFromText(values.command ?? "") }),
  // A list stays a list when edited: its text is words, not JSON.
  forService: ({ command }) =>
    Array.isArray(command)
      ? {
          ...commandForm,
          problem: (key, value) => (key === "command" ? commandWordsProblem(value) : undefined),
          written: (values) => ({
            type: "command",
            command: commandFromWords(values.command ?? ""),
          }),
        }
      : commandForm,
};
