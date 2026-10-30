// A fake OpenAI for the chat tests: an injected fetch that replays scripted
// Responses API streams. The event shapes follow the Responses API reference
// (response.output_text.delta, response.output_item.done, response.completed,
// function_call items with call_id); they are written out here, not captured,
// because recording a real exchange would spend. Nothing reaches the network.

const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");

/** A streamed reply that says `text`, in two deltas. */
export function textReply(text, id = "msg_1") {
  const half = Math.ceil(text.length / 2);
  const item = { id, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] };
  return [
    { type: "response.created", response: { id: "resp_t", status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
    { type: "response.output_text.delta", item_id: id, output_index: 0, content_index: 0, delta: text.slice(0, half) },
    { type: "response.output_text.delta", item_id: id, output_index: 0, content_index: 0, delta: text.slice(half) },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id: "resp_t", status: "completed", output: [item] } },
  ];
}

/** A streamed reply that calls one function. */
export function callReply(name, args, callId = "call_1") {
  const item = { id: `fc_${callId}`, type: "function_call", status: "completed", call_id: callId, name, arguments: JSON.stringify(args) };
  return [
    { type: "response.created", response: { id: "resp_c", status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", arguments: "" } },
    { type: "response.function_call_arguments.delta", item_id: item.id, output_index: 0, delta: item.arguments },
    { type: "response.function_call_arguments.done", item_id: item.id, output_index: 0, arguments: item.arguments },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id: "resp_c", status: "completed", output: [item] } },
  ];
}

/**
 * fetch for https://api.openai.com/v1/responses and /v1/models. `replies` is
 * one entry per POST /v1/responses, in order: an event list (streamed) or
 * { status, error } (an HTTP error). `models` answers GET /v1/models.
 * `requests` records each call's url and parsed body; `auth` records whether
 * a bearer token was sent, never the token.
 */
export function fakeOpenAI({ replies = [], models = [] } = {}) {
  const requests = [];
  const queue = [...replies];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url: u, method: init.method ?? "GET", body, auth: /^Bearer \S+$/.test(init.headers?.authorization ?? "") });
    if (u === "https://api.openai.com/v1/models") return new Response(JSON.stringify({ object: "list", data: models }), { status: 200 });
    if (u !== "https://api.openai.com/v1/responses") throw new Error(`fake OpenAI: unexpected ${u}`);
    const next = queue.shift();
    if (!next) throw new Error("fake OpenAI: no reply left for this request");
    if (!Array.isArray(next)) return new Response(JSON.stringify({ error: next.error }), { status: next.status });
    return new Response(sse(next), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  return { fetch, requests, left: () => queue.length };
}
