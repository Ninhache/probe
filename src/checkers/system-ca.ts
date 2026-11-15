/** The part of `node:tls` used here. Both functions are missing from the oldest Node 22 releases. */
export interface CertificateStore {
  getCACertificates?: (type: "default" | "system") => string[];
  setDefaultCACertificates?: (certificates: string[]) => void;
}

export interface SystemTrust {
  readonly tried: boolean;
  load(): Promise<boolean>;
}

// Reading the system store takes about 100 ms: done once, and only when a certificate was refused for its issuer.
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
