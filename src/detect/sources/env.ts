import type { RawConfig } from "../../config/migrations";
import { DEFAULT_HOST, DEFAULT_NAME, parseEnvFile, serviceName } from "../shared";
import type { Candidate, Source } from "../types";

const ENV_FILES = [".env", ".env.local"];
const LOCAL_HOSTS = [DEFAULT_HOST, "127.0.0.1", "::1"];
const URL_KEY = /^(?:VITE_|NEXT_PUBLIC_|REACT_APP_|PUBLIC_)?(.*)_URL$/;

/** Keeps the host, port and path of a local http URL: credentials and query are dropped. */
function serviceOfUrl(value: string): RawConfig | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "http:" || !LOCAL_HOSTS.includes(host)) return null;
  const service: RawConfig = { port: Number(url.port || 80) };
  if (host !== DEFAULT_HOST) service.host = host;
  if (url.pathname !== "/") service.path = url.pathname;
  return service;
}

function inFile(file: string, text: string): Candidate[] {
  const found: Candidate[] = [];
  for (const [key, value] of parseEnvFile(text)) {
    const source = `${file} (${key})`;
    const urlName = URL_KEY.exec(key)?.[1];
    if (key === "PORT" && /^\d+$/.test(value)) {
      found.push({ name: DEFAULT_NAME, service: { port: Number(value) }, source });
    } else if (urlName !== undefined) {
      const service = serviceOfUrl(value);
      if (service) found.push({ name: serviceName(urlName), service, source });
    }
  }
  return found;
}

/** `PORT` and the `*_URL` pointing to a local http server, in `.env` and `.env.local`. */
export const envSource: Source = {
  id: "env",
  async find({ read }) {
    const found: Candidate[] = [];
    for (const file of ENV_FILES) {
      const text = await read(file);
      if (text !== null) found.push(...inFile(file, text));
    }
    return found;
  },
};
