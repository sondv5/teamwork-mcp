import { promises as fs } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import os from "node:os";
import path from "node:path";

export interface Credential {
  site: string;
  key: string;
}

const SERVICE = "teamwork-mcp";
const ACCOUNT = "default";

const CONFIG_DIR = path.join(
  process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
  "teamwork-mcp",
);
const CONFIG_FILE = path.join(CONFIG_DIR, "credentials.json");

interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
}

interface KeyringModule {
  Entry: new (service: string, account: string) => KeyringEntry;
}

async function loadKeyring(): Promise<KeyringModule | null> {
  try {
    return (await import("@napi-rs/keyring")) as unknown as KeyringModule;
  } catch {
    return null;
  }
}

export function normalizeSite(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Site is required");
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let hostname: string;
  try {
    hostname = new URL(withProtocol).hostname;
  } catch {
    throw new Error(`Invalid Teamwork site: ${input}`);
  }
  if (!hostname.includes(".")) throw new Error(`Invalid Teamwork site: ${input}`);
  return hostname;
}

function parseCredential(raw: string): Credential | null {
  try {
    const parsed = JSON.parse(raw) as Partial<Credential>;
    if (typeof parsed.site !== "string" || typeof parsed.key !== "string") return null;
    if (!parsed.site || !parsed.key) return null;
    return { site: parsed.site, key: parsed.key };
  } catch {
    return null;
  }
}

function fileCipherKey(): Buffer {
  const material = `${os.hostname()}|${os.userInfo().username}|teamwork-mcp`;
  return scryptSync(material, "teamwork-mcp-v1", 32);
}

function encryptPayload(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", fileCipherKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return JSON.stringify({
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  });
}

function decryptPayload(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as {
      v?: number;
      iv?: string;
      tag?: string;
      data?: string;
    };
    if (parsed.v !== 1 || !parsed.iv || !parsed.tag || !parsed.data) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      fileCipherKey(),
      Buffer.from(parsed.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export async function loadCredential(): Promise<Credential | null> {
  const envKey = process.env.TEAMWORK_API_KEY?.trim();
  const envSite = process.env.TEAMWORK_SITE?.trim();
  if (envKey && envSite) return { site: normalizeSite(envSite), key: envKey };

  const keyring = await loadKeyring();
  if (keyring) {
    try {
      const raw = new keyring.Entry(SERVICE, ACCOUNT).getPassword();
      if (raw) {
        const cred = parseCredential(raw);
        if (cred) return cred;
      }
    } catch {
      // keyring unavailable (e.g. headless Linux) - fall through to file
    }
  }

  let raw: string;
  try {
    raw = await fs.readFile(CONFIG_FILE, "utf8");
  } catch {
    return null;
  }
  // Only accept AES-256-GCM encrypted payloads. Legacy plaintext files are
  // rejected on purpose: user re-auths once and the file is rewritten encrypted.
  const decrypted = decryptPayload(raw);
  if (!decrypted) return null;
  return parseCredential(decrypted);
}

export async function saveCredential(cred: Credential): Promise<string> {
  const payload = JSON.stringify(cred);
  const keyring = await loadKeyring();
  if (keyring) {
    try {
      new keyring.Entry(SERVICE, ACCOUNT).setPassword(payload);
      return "OS keychain";
    } catch {
      // fall through to file storage
    }
  }
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(CONFIG_FILE, encryptPayload(payload), { encoding: "utf8", mode: 0o600 });
  return `${CONFIG_FILE} (encrypted)`;
}

export async function clearCredential(): Promise<boolean> {
  let removed = false;
  const keyring = await loadKeyring();
  if (keyring) {
    try {
      removed = new keyring.Entry(SERVICE, ACCOUNT).deletePassword() || removed;
    } catch {
      // ignore
    }
  }
  try {
    await fs.rm(CONFIG_FILE);
    removed = true;
  } catch {
    // ignore
  }
  return removed;
}

export function credentialStoreHint(): string {
  return process.platform === "win32"
    ? "Windows Credential Manager (fallback: AES-256-GCM encrypted file)"
    : `OS keychain (fallback: ${CONFIG_FILE}, AES-256-GCM encrypted)`;
}
