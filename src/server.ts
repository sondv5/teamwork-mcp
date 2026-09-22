import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AuthManager } from "./auth.js";
import { registerTools } from "./tools.js";
import { VERSION } from "./version.js";

export async function startServer(): Promise<void> {
  const auth = new AuthManager();
  await auth.init();
  await auth.startSetup();

  const server = new McpServer({ name: "teamwork-mcp", version: VERSION });
  registerTools(server, auth);

  const transport = new StdioServerTransport();
  transport.onclose = () => auth.stop();
  await server.connect(transport);

  process.stderr.write(
    `teamwork-mcp ${VERSION}: ` +
      (auth.authenticated
        ? `connected to ${auth.site}\n`
        : "no API key yet - first tool call will open the setup page\n"),
  );
}
