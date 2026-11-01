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

/**
 * How long the chat waits for one tool. The MCP SDK's own default is 60 s,
 * shorter than wait_job alone (up to 120 s) and a film_all that uploads and
 * submits many shots; a call cut off early keeps running on the server, so
 * the wait is long and a cut-off call is reported as uncertain.
 */
export const TOOL_TIMEOUT_MS = 30 * 60_000;

/** What the model and the page read when a call's answer never came: it may have done its work. */
export const UNCERTAIN_CALL = "may have been submitted; check the feed / call status before doing anything else";

/**
 * MCP tools the chat is never given. A scene's draft and final are buttons
 * Alex presses in the Scene editor; the chat reads and writes scenes only.
 */
export const CHAT_HIDDEN = new Set(["draft_scene", "final_scene"]);
const HIDDEN_TEXT = (name) =>
  `Error 1: ${name} is not available in the chat. Drafts and finals are made with the Draft and Make final buttons in the Scene editor; ask the user to press one.`;

// McpError codes for a request whose answer was lost: timed out, or the connection closed under it.
const LOST = new Set([-32001, -32000]);
const lost = (err) => LOST.has(err?.code) || err?.name === "AbortError";

export function createTools({ deps = {}, catalog, timeoutMs = TOOL_TIMEOUT_MS } = {}) {
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
      return tools.filter((t) => !CHAT_HIDDEN.has(t.name)).map((t) => ({ type: "function", name: t.name, description: t.description ?? "", parameters: functionSchema(t.inputSchema), strict: false }));
    },
    /**
     * A tool's result; a call the SDK itself rejects (an unknown tool, bad
     * arguments) comes back as an error result too. `signal` cancels the
     * call: it then throws, and the step is left for the turn to settle. A
     * call whose answer was lost (timed out, cut off) is code 5: the server
     * may still be running it, so it must not be retried blind.
     */
    async call(name, args, { signal } = {}) {
      if (CHAT_HIDDEN.has(name)) return { isError: true, content: [{ type: "text", text: HIDDEN_TEXT(name) }], _meta: { error: { code: 1 } } };
      const { client } = await open();
      try {
        return await client.callTool({ name, arguments: args ?? {} }, undefined, { signal, timeout: timeoutMs });
      } catch (err) {
        if (signal?.aborted) throw err;
        if (lost(err)) {
          const text = `Error 5: ${name} did not answer (${err.message}); it ${UNCERTAIN_CALL}.`;
          return { isError: true, content: [{ type: "text", text }], _meta: { error: { code: 5, retryable: false } } };
        }
        return { isError: true, content: [{ type: "text", text: `Error 1: ${err.message}` }], _meta: { error: { code: 1 } } };
      }
    },
    async close() {
      if (conn) await (await conn.catch(() => null))?.close();
      conn = null;
    },
  };
}
