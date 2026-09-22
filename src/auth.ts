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
  constructor(readonly setupUrl: string) {
    super(
      "No Teamwork API key on this machine.\n" +
        `Opened the setup page: ${setupUrl}\n` +
        "(if the browser did not open automatically, copy this URL into your browser)\n" +
        "Enter your Teamwork site + API key, click Save, then call this tool again.",
    );
    this.name = "AuthRequiredError";
  }
}

export function openBrowser(url: string): void {
  if (process.env.TEAMWORK_MCP_NO_BROWSER === "1") return;
  const command =
    process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(command, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    // user can open the URL manually
  }
}

function mask(key: string): string {
  return key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : "***";
}

export class AuthManager {
  private credential: Credential | null = null;
  private setup: SetupServer | null = null;
  private browserOpened = false;

  async init(): Promise<void> {
    this.credential = await loadCredential();
  }

  async startSetup(): Promise<void> {
    if (this.setup) return;
    const setup = new SetupServer((cred) => {
      this.credential = cred;
    });
    await setup.start();
    this.setup = setup;
  }

  get authenticated(): boolean {
    return this.credential !== null;
  }

  get site(): string | null {
    return this.credential?.site ?? null;
  }

  client(): TeamworkClient {
    if (this.credential) return new TeamworkClient(this.credential);
    if (!this.setup) throw new AuthRequiredError("(setup page not ready yet, try again)");
    if (!this.browserOpened) {
      this.browserOpened = true;
      openBrowser(this.setup.url);
    }
    throw new AuthRequiredError(this.setup.url);
  }

  async logout(): Promise<boolean> {
    const removed = await clearCredential();
    this.credential = null;
    this.browserOpened = false;
    return removed;
  }

  async status(): Promise<Record<string, unknown>> {
    if (!this.credential) {
      return {
        authenticated: false,
        setupUrl: this.setup?.url ?? null,
        storage: credentialStoreHint(),
      };
    }
    return {
      authenticated: true,
      site: this.credential.site,
      key: mask(this.credential.key),
      storage: credentialStoreHint(),
    };
  }

  stop(): void {
    this.setup?.stop();
    this.setup = null;
  }
}

class SetupServer {
  private server: Server | null = null;
  private readonly nonce = randomBytes(16).toString("hex");
  private port = 0;

  constructor(private readonly onSaved: (cred: Credential) => void) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}/setup/${this.nonce}`;
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
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ ok: true, site, person: me.person ?? {} }));
      } catch (err) {
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
      <input id="site" placeholder="congty.teamwork.com" autocomplete="off" required />
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
