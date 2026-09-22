#!/usr/bin/env node
import { runAuth, runLogout, runStatus } from "./cli.js";
import { startServer } from "./server.js";
import { VERSION } from "./version.js";

const HELP = `teamwork-mcp ${VERSION} - MCP server for Teamwork.com (personal API key)

Usage:
  teamwork-mcp            Start the MCP server (stdio) - used by MCP clients
  teamwork-mcp auth       Store your Teamwork site + personal API key (OS keychain)
  teamwork-mcp status     Show which credential is configured
  teamwork-mcp logout     Remove the stored credential

MCP client config:
  { "mcpServers": { "teamwork": { "command": "npx", "args": ["-y", "teamwork-mcp"] } } }

Environment overrides (optional, for CI):
  TEAMWORK_SITE, TEAMWORK_API_KEY
`;

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);

  switch (command) {
    case "auth":
      await runAuth();
      return;
    case "status":
      await runStatus();
      return;
    case "logout":
      await runLogout();
      return;
    case "-v":
    case "--version":
      process.stdout.write(`${VERSION}\n`);
      return;
    case "-h":
    case "--help":
      process.stdout.write(HELP);
      return;
    case undefined:
      await startServer();
      return;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
      process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  if ((err as Error)?.name === "ExitPromptError") {
    process.exit(130);
  }
  process.stderr.write(`teamwork-mcp: ${(err as Error).message}\n`);
  process.exit(1);
});
