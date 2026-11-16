export const PACKAGE_NAME = "@ninhache/probe";

export const PROBE_DIR = ".probe";
export const CONFIG_FILE = "config.yml";
export const LOCK_FILE = "lock.yml";
export const LOCAL_FILE = "local.yml";
export const ENVIRONMENTS_DIR = "envs";
export const LOCAL_ENVIRONMENT = "local";
export const BACKUP_GLOB = "*.bak.yml";
// Matches BACKUP_GLOB, so the copy written before replacing local.yml is git-ignored too.
export const LOCAL_DRAFT_FILE = "local.draft.bak.yml";
// local.yml is where credentials go: a new one is readable by its owner only.
export const LOCAL_FILE_MODE = 0o600;
export const LOCAL_VARIABLES_KEY = "variables";
export const LOCAL_ENVIRONMENTS_KEY = "envs";
/** Redirects followed for a service that sends headers, as many as `fetch` follows by itself. */
export const MAX_REDIRECTS = 20;

export const DEFAULT_MAKEFILE = "Makefile";

export const DEFAULT_CHECKER_TYPE = "http";
export const DEFAULT_TIMEOUT_SECONDS = 3;
export const DASHBOARD_INTERVAL_SECONDS = 2;
export const DASHBOARD_HISTORY_LENGTH = 30;
export const RESPONSE_BODY_BYTES = 2_048;
export const RESPONSE_BODY_WAIT_MS = 500;
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
export const COMPLETE_COMMAND = "__complete";

export const EXIT_OK = 0;
export const EXIT_DOWN = 1;
export const EXIT_ERROR = 2;

// Not 5000 nor 7000: on macOS, AirPlay Receiver answers there.
export const DETECT_PORTS = [3000, 3001, 4200, 4321, 5173, 8000, 8080];
export const DETECT_PORTS_ENV = "PROBE_DETECT_PORTS";
// A local server answers in a few ms: a short limit keeps `init` and `add` instant.
export const DETECT_TIMEOUT_MS = 300;

export const NOTIFY_WAIT_MS = 5_000;

export const DOCTOR_COMMAND_TIMEOUT_MS = 3_000;
// Only this machine is asked: a port that is open answers at once.
export const DOCTOR_CONNECT_TIMEOUT_MS = 500;
