import { defineCommand } from "citty";
import { bashScript } from "../completion/bash";
import {
  COMPLETION_COMMAND,
  type CommandLike,
  completionSpec,
  SHELLS,
  type Shell,
} from "../completion/spec";
import { zshScript } from "../completion/zsh";
import { ProbeError } from "../errors";

const SCRIPTS: Record<Shell, typeof zshScript> = { zsh: zshScript, bash: bashScript };

const meta = {
  name: COMPLETION_COMMAND,
  description: `Print the shell completion script (${SHELLS.join(", ")})`,
};
const args = {
  shell: { type: "positional", description: SHELLS.join(" or "), required: true },
} as const;

/**
 * Builds `probe completion <shell>`, which prints the completion script of a shell.
 * It is given the other commands, and completes itself too.
 */
export default function completion(others: Record<string, CommandLike>) {
  const commands = { ...others, [COMPLETION_COMMAND]: { meta, args } };
  return defineCommand({
    meta,
    args,
    run({ args: { shell } }) {
      const script = Object.hasOwn(SCRIPTS, shell) ? SCRIPTS[shell as Shell] : undefined;
      if (!script) {
        throw new ProbeError(
          "USAGE",
          `no completion for the shell "${shell}". Supported: ${SHELLS.join(", ")}.`,
        );
      }
      process.stdout.write(script(completionSpec(commands)));
    },
  });
}
