import { DEFAULT_PORTS, type Parameter, type Service } from "../config/schema";
import { targetUrl } from "./http";

// What a service declares itself wins: it is the way to keep one service out of a parameter.
// A value without an entry in `urls` keeps the address of the service.
export function withHttpParameters(
  service: Service,
  chosen: readonly [Parameter, string][],
): Service {
  const headers = { ...service.headers };
  const sent = new Set(Object.keys(headers).map((name) => name.toLowerCase()));
  const segments: string[] = [];
  const queries: [string, string][] = [];
  let address: string | undefined;
  for (const [{ strategy }, value] of chosen) {
    if (strategy.kind === "url") address = service.urls?.[value];
    else if (strategy.kind === "path") segments.push(value);
    else if (strategy.kind === "query") queries.push([strategy.name, value]);
    else if (!sent.has(strategy.name.toLowerCase())) headers[strategy.name] = value;
  }
  const next: Service = { ...service };
  if (Object.keys(headers).length > 0) next.headers = headers;
  if (address !== undefined && URL.canParse(address)) {
    const { hostname, port, protocol, pathname, search } = new URL(address);
    next.url = address;
    next.host = hostname;
    next.port = Number(port) || DEFAULT_PORTS[protocol as keyof typeof DEFAULT_PORTS];
    next.path = pathname + search;
  }
  const target = targetUrl(next);
  if (segments.length + queries.length === 0 || !URL.canParse(target)) return next;

  const url = new URL(target);
  if (segments.length > 0) {
    const encoded = segments.map(encodeURIComponent).join("/");
    url.pathname = `/${encoded}${url.pathname === "/" ? "" : url.pathname}`;
  }
  for (const [name, value] of queries) {
    if (url.searchParams.has(name)) continue;
    // Appended as text: `searchParams.append` would rewrite the query the service declares.
    url.search = `${url.search === "" ? "?" : `${url.search}&`}${name}=${encodeURIComponent(value)}`;
  }
  next.path = url.pathname + url.search;
  if (next.url !== undefined) next.url = url.href;
  return next;
}
