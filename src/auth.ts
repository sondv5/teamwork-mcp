import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { TeamworkClient } from "./client.js";
import {
  clearCredential,
  credentialStoreHint,
  loadCredential,
  normalizeSite,
  saveCredential,
  type Credential,
} from "./credentials.js";

export class AuthRequiredError extends Error {
  readonly setupUrl: string;
  readonly browserOpened: boolean;

  constructor(setupUrl: string, browserOpened = false) {
    const action = browserOpened
      ? `Opened the setup page in your browser: ${setupUrl}`
      : `Open this setup page in your browser: ${setupUrl}`;
    super(
      "No Teamwork API key on this machine.\n" +
        `${action}\n` +
        "Enter your Teamwork site + API key, click Save, then call this tool again.",
    );
    this.name = "AuthRequiredError";
    this.setupUrl = setupUrl;
    this.browserOpened = browserOpened;
  }
}

export function openBrowser(url: string): boolean {
  if (process.env.TEAMWORK_MCP_NO_BROWSER === "1") return false;
  const command =
    process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(command, args, { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    // user can open the URL manually
    return false;
  }
}

function mask(key: string): string {
  return key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : "***";
}

export class AuthManager {
  private credential: Credential | null = null;
  private setup: SetupServer | null = null;
  private lastBrowserOpenedAt = 0;

  /** Re-open the browser at most once per interval to avoid tab spam on retries. */
  private static readonly BROWSER_REOPEN_MS = 60_000;

  async init(): Promise<void> {
    this.credential = await loadCredential();
  }

  async startSetup(): Promise<void> {
    if (this.setup) return;
    const setup = new SetupServer((cred) => {
      this.credential = cred;
      this.lastBrowserOpenedAt = 0;
    });
    await setup.start();
    this.setup = setup;
  }

  get authenticated(): boolean {
    return this.credential !== null;
  }

  /** Tools use this. They receive a TeamworkClient and never learn where the key is stored. */
  get site(): string | null {
    return this.credential?.site ?? null;
  }

  client(): TeamworkClient {
    if (this.credential) return new TeamworkClient(this.credential);
    if (!this.setup) throw new AuthRequiredError("(setup page not ready yet, try again)");
    if (this.setup.isExpired()) this.setup.refresh();
    const now = Date.now();
    let opened = false;
    if (now - this.lastBrowserOpenedAt > AuthManager.BROWSER_REOPEN_MS) {
      opened = openBrowser(this.setup.url);
      if (opened) this.lastBrowserOpenedAt = now;
    }
    throw new AuthRequiredError(this.setup.url, opened);
  }

  /** Called when the API rejects the stored key (401). Drops it so the next call re-opens setup. */
  async handleUnauthorized(): Promise<void> {
    await clearCredential().catch(() => {});
    this.credential = null;
    this.lastBrowserOpenedAt = 0;
  }

  async logout(): Promise<boolean> {
    const removed = await clearCredential();
    this.credential = null;
    this.lastBrowserOpenedAt = 0;
    return removed;
  }

  async status(): Promise<Record<string, unknown>> {
    const envOverride = Boolean(
      process.env.TEAMWORK_API_KEY?.trim() && process.env.TEAMWORK_SITE?.trim(),
    );
    if (!this.credential) {
      return {
        authenticated: false,
        setupUrl: this.setup?.url ?? null,
        storage: credentialStoreHint(),
        envOverride,
      };
    }
    return {
      authenticated: true,
      site: this.credential.site,
      key: mask(this.credential.key),
      storage: credentialStoreHint(),
      envOverride,
    };
  }

  stop(): void {
    this.setup?.stop();
    this.setup = null;
  }
}

class SetupServer {
  private server: Server | null = null;
  private nonce = randomBytes(16).toString("hex");
  private port = 0;
  private createdAt = Date.now();
  private failedAttempts = 0;
  private failureWindowStart = 0;

  /** Rotate the setup URL after this long to bound nonce lifetime. */
  private static readonly MAX_AGE_MS = 2 * 60 * 60 * 1000;
  /** Simple brute-force guard for the local POST endpoint. */
  private static readonly MAX_FAILURES = 10;
  private static readonly FAILURE_WINDOW_MS = 5 * 60 * 1000;

  constructor(private readonly onSaved: (cred: Credential) => void) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}/setup/${this.nonce}`;
  }

  isExpired(): boolean {
    return Date.now() - this.createdAt > SetupServer.MAX_AGE_MS;
  }

  refresh(): void {
    this.nonce = randomBytes(16).toString("hex");
    this.createdAt = Date.now();
    this.failedAttempts = 0;
    this.failureWindowStart = 0;
  }

  private isRateLimited(): boolean {
    return (
      this.failedAttempts >= SetupServer.MAX_FAILURES &&
      Date.now() - this.failureWindowStart < SetupServer.FAILURE_WINDOW_MS
    );
  }

  private recordFailure(): void {
    const now = Date.now();
    if (now - this.failureWindowStart > SetupServer.FAILURE_WINDOW_MS) {
      this.failureWindowStart = now;
      this.failedAttempts = 1;
    } else {
      this.failedAttempts += 1;
    }
  }

  async start(): Promise<void> {
    const server = createServer((req, res) => {
      this.handle(req, res).catch(() => {
        try {
          res.destroy();
        } catch {
          // ignore
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address && typeof address === "object") this.port = address.port;
        server.unref();
        resolve();
      });
    });
    this.server = server;
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
    if (url.pathname !== `/setup/${this.nonce}`) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }

    if (req.method === "GET") {
      res
        .writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        })
        .end(SETUP_HTML);
      return;
    }

    if (req.method === "POST") {
      if (this.isRateLimited()) {
        // Too many bad attempts recently - ask the browser to back off.
        res
          .writeHead(429, { "content-type": "application/json" })
          .end(JSON.stringify({ ok: false, error: "Too many attempts, try again later" }));
        return;
      }
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body) as { site?: string; key?: string };
        const site = normalizeSite(parsed.site ?? "");
        const key = (parsed.key ?? "").trim();
        if (!key) throw new Error("API key is required");

        const me = await new TeamworkClient({ site, key }).get<{
          person?: { firstName?: string; lastName?: string; email?: string };
        }>("/me.json");

        await saveCredential({ site, key });
        this.onSaved({ site, key });
        this.failedAttempts = 0;
        this.failureWindowStart = 0;
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ ok: true, site, person: me.person ?? {} }));
      } catch (err) {
        this.recordFailure();
        res
          .writeHead(400, { "content-type": "application/json" })
          .end(JSON.stringify({ ok: false, error: (err as Error).message }));
      }
      return;
    }

    res.writeHead(405, { "content-type": "text/plain" }).end("Method not allowed");
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > 64 * 1024) throw new Error("Body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const SETUP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Teamwork MCP - Setup</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 0; display: grid; place-items: center; min-height: 100vh; background: #f4f4f5; }
  main { width: min(420px, 92vw); background: #fff; color: #18181b; border-radius: 12px; padding: 28px; box-shadow: 0 8px 30px rgba(0,0,0,.08); }
  h1 { margin: 0 0 8px; font-size: 20px; }
  p { margin: 0 0 16px; font-size: 14px; color: #52525b; line-height: 1.5; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 0 0 12px; }
  input { width: 100%; box-sizing: border-box; margin-top: 6px; padding: 10px 12px; font-size: 14px; border: 1px solid #d4d4d8; border-radius: 8px; }
  button { width: 100%; padding: 11px; font-size: 15px; font-weight: 600; color: #fff; background: #2563eb; border: 0; border-radius: 8px; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  #msg { margin: 14px 0 0; font-size: 13px; }
  #msg.ok { color: #15803d; }
  #msg.err { color: #b91c1c; }
  details { margin-top: 16px; font-size: 13px; color: #52525b; }
  summary { cursor: pointer; font-weight: 600; }
  ol { padding-left: 18px; line-height: 1.6; }
</style>
</head>
<body>
<main>
  <h1>Connect Teamwork</h1>
  <p>Enter your Teamwork site and personal API key. The key is only sent to Teamwork for verification, then stored on this machine (Windows Credential Manager / encrypted file).</p>
  <form id="form">
    <label>Teamwork site
      <input id="site" placeholder="company.teamwork.com" autocomplete="off" required />
    </label>
    <label>API key
      <input id="key" type="password" autocomplete="off" required />
    </label>
    <button id="btn" type="submit">Save</button>
  </form>
  <p id="msg"></p>
  <details>
    <summary>How to get an API key</summary>
    <ol>
      <li>Open Teamwork and click your profile icon in the bottom-left corner.</li>
      <li>Choose <b>Edit My Details</b>.</li>
      <li>Go to the <b>API &amp; Mobile</b> tab and click <b>Show your Token</b>.</li>
      <li>Copy the key and paste it into the field above.</li>
    </ol>
  </details>
</main>
<script>
  var form = document.getElementById("form");
  var siteEl = document.getElementById("site");
  var keyEl = document.getElementById("key");
  var btn = document.getElementById("btn");
  var msg = document.getElementById("msg");

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    btn.disabled = true;
    msg.className = "";
    msg.textContent = "Verifying...";
    try {
      var res = await fetch(location.href, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site: siteEl.value, key: keyEl.value }),
      });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error || "Unknown error");
      var name = [data.person && data.person.firstName, data.person && data.person.lastName].filter(Boolean).join(" ");
      msg.className = "ok";
      msg.textContent = "Success! Connected to " + data.site + (name ? " (" + name + ")" : "") + ". Go back to chat and retry the tool you just called.";
      form.reset();
    } catch (err) {
      msg.className = "err";
      msg.textContent = "Error: " + err.message;
    }
    btn.disabled = false;
  });
</script>
</body>
</html>
`;
