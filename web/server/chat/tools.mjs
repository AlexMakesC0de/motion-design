// The chat's tools are exactly the motion-design MCP tools, reached through
// an in-process MCP client over createServer() (mcp/client.mjs). The MCP
// package is imported on first use, so the studio still starts when
// mcp/node_modules is missing; only the chat then says what to install.
import { usage } from "../../../cli/lib/errors.mjs";

/** JSON Schema keywords the Responses API's function parameters do not take. */
const DROP = new Set(["$schema", "propertyNames"]);
export function functionSchema(schema) {
  if (Array.isArray(schema)) return schema.map(functionSchema);
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(Object.entries(schema).filter(([k]) => !DROP.has(k)).map(([k, v]) => [k, functionSchema(v)]));
}

export function createTools({ deps = {}, catalog } = {}) {
  let conn = null;
  const open = () =>
    (conn ??= import("../../../mcp/client.mjs")
      .then((m) => m.connectInProcess({ deps, catalog }))
      .catch((err) => {
        conn = null;
        if (err?.code === "ERR_MODULE_NOT_FOUND") throw usage("The chat needs the MCP package. Run: npm --prefix mcp install");
        throw err;
      }));

  return {
    async instructions() {
      return (await open()).client.getInstructions() ?? "";
    },
    /** The tools as Responses API function tools. */
    async functions() {
      const { tools } = await (await open()).client.listTools();
      return tools.map((t) => ({ type: "function", name: t.name, description: t.description ?? "", parameters: functionSchema(t.inputSchema), strict: false }));
    },
    /** A tool's result; a call the SDK itself rejects (an unknown tool, bad arguments) comes back as an error result too. */
    async call(name, args) {
      const { client } = await open();
      try {
        return await client.callTool({ name, arguments: args ?? {} });
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: `Error 1: ${err.message}` }], _meta: { error: { code: 1 } } };
      }
    },
    async close() {
      if (conn) await (await conn.catch(() => null))?.close();
      conn = null;
    },
  };
}
