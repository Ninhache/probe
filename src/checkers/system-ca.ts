/** The part of `node:tls` used here. Both functions are missing from the oldest Node 22 releases. */
export interface CertificateStore {
  getCACertificates?: (type: "default" | "system") => string[];
  setDefaultCACertificates?: (certificates: string[]) => void;
}

export interface SystemTrust {
  /** Whether `load` was already called: what it could add is there, or never will be. */
  readonly tried: boolean;
  /**
   * Makes https requests trust what the system trusts, on top of what Node ships with: curl and
   * browsers do, and a local CA (mkcert) is installed there. Resolves to whether they now do.
   */
  load(): Promise<boolean>;
}

/**
 * Reading the system store takes about 100 ms, so it is read once, and only when asked: when a
 * certificate was refused for its issuer. `node:tls` is loaded then too, not at startup.
 */
export function createSystemTrust(
  loadStore: () => Promise<CertificateStore> = () => import("node:tls"),
): SystemTrust {
  let loading: Promise<boolean> | undefined;
  const read = async () => {
    try {
      const { getCACertificates, setDefaultCACertificates } = await loadStore();
      if (!getCACertificates || !setDefaultCACertificates) return false;
      const known = new Set(getCACertificates("default"));
      for (const certificate of getCACertificates("system")) known.add(certificate);
      setDefaultCACertificates([...known]);
      return true;
    } catch {
      // A store that cannot be read leaves the checks as strict as Node is.
      return false;
    }
  };
  return {
    get tried() {
      return loading !== undefined;
    },
    load() {
      loading ??= read();
      return loading;
    },
  };
}

export const systemTrust = createSystemTrust();
