export const PACKAGE_NAME = "@ninhache/probe";

export const PROBE_DIR = ".probe";
export const CONFIG_FILE = "config.yml";
export const LOCK_FILE = "lock.yml";
export const LOCAL_FILE = "local.yml";
export const BACKUP_GLOB = "*.bak.yml";
// Matches BACKUP_GLOB, so the copy written before replacing local.yml is git-ignored too.
export const LOCAL_DRAFT_FILE = "local.draft.bak.yml";
// local.yml is where credentials go: a new one is readable by its owner only.
export const LOCAL_FILE_MODE = 0o600;

export const DEFAULT_MAKEFILE = "Makefile";

export const DEFAULT_CHECKER_TYPE = "http";
export const DEFAULT_TIMEOUT_SECONDS = 3;
/** Pause between two passes of the dashboard, counted from the end of a pass. */
export const DASHBOARD_INTERVAL_SECONDS = 2;
/** Values the options panel of the dashboard steps through, in seconds. */
export const DASHBOARD_INTERVAL_CHOICES_SECONDS = [0.5, 1, 2, 5, 10, 30, 60];
export const DASHBOARD_TIMEOUT_CHOICES_SECONDS = [1, 2, 3, 5, 10, 30];
// setTimeout overflows above 2^31 ms and then fires at once.
export const MAX_TIMEOUT_SECONDS = 2_147_483;

export const DEFAULT_WAIT_TIMEOUT_SECONDS = 60;
export const DEFAULT_WAIT_INTERVAL_SECONDS = 0.5;
export const DEFAULT_WAIT_MAX_INTERVAL_SECONDS = 5;
export const WAIT_BACKOFF_FACTOR = 2;
// Time kept before the deadline for one last check, so the final report is not a pause old.
export const WAIT_LAST_PASS_MS = 1_000;

export const REGISTRY_LATEST_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
export const REGISTRY_TIMEOUT_MS = 5_000;
export const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_CACHE_FILE = "latest.json";
export const REFRESH_COMMAND = "__refresh-update-cache";

export const EXIT_OK = 0;
export const EXIT_DOWN = 1;
export const EXIT_ERROR = 2;
