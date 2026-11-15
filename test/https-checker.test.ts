import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpChecker, httpChecker } from "../src/checkers/http";
import { createSystemTrust } from "../src/checkers/system-ca";
import { serviceSchemaV1 } from "../src/config/schema";

interface Certificate {
  key: string;
  cert: string;
}

/** A self-signed certificate for `names`, made now: no key is kept in the repository. */
function selfSigned(dir: string, id: string, names: string): Certificate {
  const file = (extension: string) => join(dir, `${id}.${extension}`);
  writeFileSync(
    file("cnf"),
    [
      "[req]",
      "distinguished_name = dn",
      "x509_extensions = ext",
      "prompt = no",
      "[dn]",
      `CN = ${id}.probe.test`,
      "[ext]",
      `subjectAltName = ${names}`,
      "basicConstraints = critical, CA:TRUE",
      "",
    ].join("\n"),
  );
  const args = ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2"];
  execFileSync(
    "openssl",
    [...args, "-config", file("cnf"), "-keyout", file("key"), "-out", file("crt")],
    { stdio: "ignore" },
  );
  return { key: readFileSync(file("key"), "utf8"), cert: readFileSync(file("crt"), "utf8") };
}

function certificates(): { local: Certificate; elsewhere: Certificate } | undefined {
  const dir = mkdtempSync(join(tmpdir(), "probe-tls-"));
  try {
    return {
      local: selfSigned(dir, "local", "IP:127.0.0.1"),
      elsewhere: selfSigned(dir, "elsewhere", "DNS:elsewhere.probe.test"),
    };
  } catch (error) {
    // Off CI, a machine without openssl skips these tests; on CI they must run.
    if (process.env.CI) throw error;
    return undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const made = certificates();
const canTrust = typeof tls.setDefaultCACertificates === "function";

describe.skipIf(!made)("http checker over https", () => {
  const servers: Server[] = [];
  let local: number;
  let elsewhere: number;

  async function listen({ key, cert }: Certificate): Promise<number> {
    const server = createServer({ key, cert }, (_request, response) => {
      response.writeHead(200).end("ok");
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    return (server.address() as AddressInfo).port;
  }

  beforeAll(async () => {
    if (!made) return;
    local = await listen(made.local);
    elsewhere = await listen(made.elsewhere);
  });

  afterAll(() => {
    for (const server of servers) {
      server.closeAllConnections();
      server.close();
    }
  });

  const check = (port: number, checker = httpChecker) =>
    checker.check("api", serviceSchemaV1.parse({ url: `https://127.0.0.1:${port}/health` }), {
      timeoutMs: 2_000,
    });

  it("reports a certificate nobody vouches for as not trusted, and says what to do", async () => {
    const result = await check(local);

    expect(result).toMatchObject({
      ok: false,
      target: `https://127.0.0.1:${local}/health`,
      error: "certificate not trusted (DEPTH_ZERO_SELF_SIGNED_CERT)",
    });
    expect(result.hint).toContain("add the CA to the system store");
    expect(result.hint).not.toContain("redirect");
  });

  it("names only the file of the CA on a Node that cannot trust the system store", async () => {
    const result = await check(local, createHttpChecker(createSystemTrust(async () => ({}))));

    expect(result.error).toBe("certificate not trusted (DEPTH_ZERO_SELF_SIGNED_CERT)");
    expect(result.hint).toBe(
      "self-signed, or from a local CA: give the file of the CA in NODE_EXTRA_CA_CERTS",
    );
  });

  it("says so when the port speaks plain http", async () => {
    const { createServer: plain } = await import("node:http");
    const server = plain((_request, response) => response.writeHead(200).end());
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const { port } = server.address() as AddressInfo;

    const result = await check(port);
    server.closeAllConnections();
    server.close();

    expect(result).toMatchObject({ ok: false, error: "no https on this port" });
    expect(result.hint).toContain("does it speak plain http?");
  });

  describe.skipIf(!canTrust)("once its certificates are trusted", () => {
    /** A system store that holds the certificates of the two servers. */
    const system = () =>
      createSystemTrust(async () => ({
        getCACertificates: (type) =>
          type === "system" && made
            ? [made.local.cert, made.elsewhere.cert]
            : tls.getCACertificates("default"),
        setDefaultCACertificates: tls.setDefaultCACertificates,
      }));

    it("asks again once the system store is trusted, and reports the service as up", async () => {
      const trust = system();

      const result = await check(local, createHttpChecker(trust));

      expect(result).toMatchObject({ ok: true, status: 200 });
      expect(trust.tried).toBe(true);
    });

    it("does not read the store for a service that answers", async () => {
      const trust = system();

      expect(await check(local, createHttpChecker(trust))).toMatchObject({ ok: true });
      expect(trust.tried).toBe(false);
    });

    it("reports a certificate made for another host", async () => {
      const result = await check(elsewhere);

      expect(result).toMatchObject({ ok: false, error: "certificate for another host" });
      expect(result.hint).toContain('does not name "127.0.0.1": check `url` in');
    });
  });
});
