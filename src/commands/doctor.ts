import { defineCommand } from "citty";
import { runChecks } from "../checkers/run";
import { requireProbeDir } from "../config/discovery";
import { environmentPaths } from "../config/environments";
import { loadConfig, pendingMigration } from "../config/loader";
import { loadVariables, readSkippedServices } from "../config/local";
import { applySelection } from "../config/parameters";
import { DEFAULT_TIMEOUT_SECONDS, EXIT_DOWN } from "../constants";
import { diagnoseServices, type ServiceReport } from "../doctor/diagnose";
import { formatDiagnosis } from "../doctor/format";
import { executableName, runCommand, tcpConnect } from "../doctor/system";
import { type BlockState, blockState } from "../makefile/sync";
import { currentPlatform } from "../platform";
import { isOnPath } from "../platform/on-path";
import { formatCheckResults } from "../ui/report";
import { cacheDir, readCache, updateCheckDisabled } from "../update/notifier";
import { CLI_VERSION } from "../version";
import {
  configFile,
  ENVIRONMENT_ARG,
  noServices,
  SET_ARG,
  secondsToMs,
  selectionFrom,
  stdoutColors,
  stdoutGlyphs,
  stdoutTerminal,
  TAG_ARG,
  tagsFrom,
} from "./shared";
import { describeBlock, describeUpdate } from "./status";

// A block that is absent is a choice, not a problem: the Makefile is optional.
const BLOCK_PROBLEMS: readonly BlockState[] = ["modified", "outdated"];

export default defineCommand({
  meta: { name: "doctor", description: "Diagnose the project and the services that are down" },
  args: {
    json: { type: "boolean", description: "Print the diagnosis as JSON" },
    env: ENVIRONMENT_ARG,
    tag: TAG_ARG,
    set: SET_ARG,
    timeout: {
      type: "string",
      description: `Seconds to wait for each service (default: its own timeout, else ${DEFAULT_TIMEOUT_SECONDS})`,
    },
  },
  async run({ args, rawArgs }) {
    const tags = tagsFrom(rawArgs);
    const forceTimeout = args.timeout !== undefined;
    const timeoutMs = secondsToMs("--timeout", args.timeout ?? String(DEFAULT_TIMEOUT_SECONDS));
    const paths = await environmentPaths(requireProbeDir(process.cwd()), args.env);
    // Loading a config that needs a migration rewrites it: doctor only looks.
    const pending = await pendingMigration(paths);
    const hasMake = await isOnPath("make");
    let makefile: BlockState | null = null;
    let services: ServiceReport[] | null = null;

    if (!pending) {
      const { config } = await loadConfig(paths);
      // The block lists the local services: another environment says nothing about it.
      if (paths.environment === undefined) makefile = await blockState(paths, config);
      const selection = selectionFrom(config, rawArgs);
      const results = await runChecks(
        config,
        args._,
        {
          timeoutMs,
          forceTimeout,
          variables: await loadVariables(paths),
          cwd: paths.root,
          configFile: configFile(paths),
          tags,
          selection,
        },
        await readSkippedServices(paths),
      );
      services = await diagnoseServices(applySelection(config, selection), results, {
        run: runCommand,
        connect: tcpConnect,
        executable: executableName,
        platform: currentPlatform,
      });
    }

    const ok =
      !pending &&
      !(hasMake && makefile && BLOCK_PROBLEMS.includes(makefile)) &&
      (services ?? []).every((service) => service.ok);

    if (args.json) {
      const latest = updateCheckDisabled() ? null : (readCache(cacheDir())?.latest ?? null);
      const project = {
        migration: pending ? { from: pending.from, to: pending.to } : null,
        makefile,
        version: CLI_VERSION,
        latest,
      };
      console.log(JSON.stringify({ ok, project, services }, null, 2));
    } else {
      const colors = stdoutColors();
      const glyphs = stdoutGlyphs();
      const line = (label: string, value: string) => console.log(`${label.padEnd(10)} ${value}`);
      if (pending) {
        const change = `schema v${pending.from} ${glyphs.arrow} v${pending.to}`;
        line(
          "migration",
          colors.yellow(`pending (${change}) ${glyphs.arrow} run \`probe migrate\``),
        );
        line("makefile", colors.dim("checked after the migration"));
        line("services", colors.dim("checked after the migration"));
      } else {
        line("migration", colors.green("none pending"));
        line(
          "makefile",
          makefile
            ? describeBlock(makefile, colors, glyphs, hasMake)
            : colors.dim("not checked with --env"),
        );
      }
      line("update", describeUpdate(colors, glyphs));
      if (services) {
        console.log("");
        if (services.length === 0) console.log(noServices(paths));
        const rows = formatCheckResults(services, stdoutTerminal(), glyphs).split("\n");
        // A hint takes a second line: the diagnosis goes after the whole entry of its service.
        let cursor = 0;
        for (const service of services) {
          const height = service.hint ? 2 : 1;
          for (const row of rows.slice(cursor, cursor + height)) console.log(row);
          cursor += height;
          for (const row of formatDiagnosis(service, colors, glyphs)) console.log(row);
        }
      }
    }
    if (!ok) process.exitCode = EXIT_DOWN;
  },
});
