import { input, password } from "@inquirer/prompts";
import { TeamworkClient } from "./client.js";
import {
  clearCredential,
  credentialStoreHint,
  loadCredential,
  normalizeSite,
  saveCredential,
} from "./credentials.js";

const SITE_HINT = "Teamwork site (e.g. acme.teamwork.com)";
const KEY_HINT = "Personal API key (Profile > Edit My Details > API & Mobile > Show your Token)";

export async function runAuth(): Promise<void> {
  const siteInput = await input({
    message: SITE_HINT,
    validate: (value) => {
      try {
        normalizeSite(value);
        return true;
      } catch (err) {
        return (err as Error).message;
      }
    },
  });
  const keyInput = await password({ message: KEY_HINT });

  const site = normalizeSite(siteInput);
  const key = keyInput.trim();
  if (!key) throw new Error("API key is required");

  const me = await new TeamworkClient({ site, key }).get<{
    person?: { firstName?: string; lastName?: string; email?: string; isAdmin?: boolean };
  }>("/me.json");

  const store = await saveCredential({ site, key });
  const person = me.person ?? {};
  const name = [person.firstName, person.lastName].filter(Boolean).join(" ") || "unknown user";
  process.stdout.write(
    `Authenticated as ${name} <${person.email ?? "no email"}> on ${site}\n` +
      `API key stored in: ${store}\n`,
  );
}

export async function runLogout(): Promise<void> {
  const removed = await clearCredential();
  process.stdout.write(removed ? "Credential removed.\n" : "No stored credential found.\n");
}

export async function runStatus(): Promise<void> {
  const cred = await loadCredential();
  if (!cred) {
    process.stdout.write("No credential configured. Run: npx -y teamwork-mcp auth\n");
    return;
  }
  const masked = cred.key.length > 8 ? `${cred.key.slice(0, 4)}...${cred.key.slice(-4)}` : "***";
  process.stdout.write(
    `Site:  ${cred.site}\n` +
      `Key:   ${masked}\n` +
      `Store: ${credentialStoreHint()}\n` +
      `Env override: ${process.env.TEAMWORK_API_KEY ? "TEAMWORK_API_KEY is set" : "not set"}\n`,
  );
}
