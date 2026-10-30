// An MCP client wired to createServer() in this process, over the SDK's
// in-memory transport. The studio's API-key chat calls the tools through it,
// so the chat sees exactly the tools, descriptions and instructions that
// Claude Code and Codex see. It lives in mcp/ so the SDK resolves from
// mcp/node_modules; the studio server itself has no dependencies.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server.mjs";

/**
 * Connect a client to a fresh server. `deps` and `catalog` go to
 * createServer() unchanged (tests pass provider stubs). Resolves
 * { client, close }.
 */
export async function connectInProcess({ deps = {}, catalog, name = "motion-design-studio" } = {}) {
  const server = createServer(catalog ? { deps, catalog } : { deps });
  const client = new Client({ name, version: "0.1.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
