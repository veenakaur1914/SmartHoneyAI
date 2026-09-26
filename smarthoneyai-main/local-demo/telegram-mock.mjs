import { createServer } from "node:http";

const messages = [];
let connectCode = "";

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function messageView(response) {
  const cards = messages.map((message) => `<article><header><strong>Delivery #${message.sequence}</strong><time>${escapeHtml(message.receivedAt)}</time></header><pre>${escapeHtml(message.text)}</pre></article>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Telegram delivery proof | SmartHoneyAI</title><style>body{margin:0;background:#071321;color:#e8f1fb;font:16px system-ui}.wrap{max-width:980px;margin:auto;padding:48px 24px}h1{font-size:36px;margin:0 0 8px}.lead{color:#9fb1c6;margin:0 0 28px}.badge{display:inline-block;color:#7ef0c7;border:1px solid #176b58;background:#0b2a2a;border-radius:99px;padding:5px 10px;font-size:13px;margin-left:10px}article{background:#102236;border:1px solid #29415a;border-radius:14px;margin:16px 0;overflow:hidden}header{display:flex;justify-content:space-between;padding:15px 18px;background:#142a41}time{color:#91a7bd;font-size:13px}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:18px;font:15px/1.55 ui-monospace,SFMono-Regular,monospace;color:#dce9f7}.note{margin-top:28px;padding:14px;border-left:3px solid #f6b93b;background:#172538;color:#b8c8d8}</style></head><body><main class="wrap"><h1>Telegram delivery proof <span class="badge">LOCAL MOCK</span></h1><p class="lead">${messages.length} sanitized SmartHoneyAI messages accepted by the test Telegram API.</p>${cards || "<p>No messages received.</p>"}<p class="note">This page exists only in the loopback-bound test service. Production sends the same sanitized templates through the official Telegram Bot API.</p></main></body></html>`;
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(html);
}

async function body(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 64 * 1024) throw new Error("BODY_TOO_LARGE");
  }
  return raw ? JSON.parse(raw) : {};
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://telegram-mock");
    if (request.method === "GET" && url.pathname === "/health/live") return json(response, 200, { status: "ok" });
    if (request.method === "POST" && url.pathname === "/test/reset") {
      messages.length = 0;
      connectCode = "";
      return json(response, 200, { status: "reset" });
    }
    if (request.method === "POST" && url.pathname === "/test/connect") {
      const input = await body(request);
      if (!/^\d{8}$/.test(input.code ?? "")) return json(response, 400, { error: "INVALID_CODE" });
      connectCode = input.code;
      return json(response, 200, { status: "ready" });
    }
    if (request.method === "GET" && url.pathname === "/test/messages") {
      return json(response, 200, { count: messages.length, messages });
    }
    if (request.method === "GET" && url.pathname === "/test/messages/view") return messageView(response);
    if (/^\/bot[^/]+\/getMe$/.test(url.pathname)) {
      return json(response, 200, { ok: true, result: { id: 110011, is_bot: true, username: "SmartHoneyAILocalDemoBot" } });
    }
    if (/^\/bot[^/]+\/getUpdates$/.test(url.pathname)) {
      const result = connectCode ? [{ update_id: 1, message: { text: `/connect@SmartHoneyAILocalDemoBot ${connectCode}`, chat: { id: -100110011, type: "group", title: "SmartHoneyAI Local Demo" } } }] : [];
      return json(response, 200, { ok: true, result });
    }
    if (request.method === "POST" && /^\/bot[^/]+\/sendMessage$/.test(url.pathname)) {
      const input = await body(request);
      const message = { sequence: messages.length + 1, chatId: String(input.chat_id ?? ""), text: String(input.text ?? ""), receivedAt: new Date().toISOString() };
      messages.push(message);
      return json(response, 200, { ok: true, result: { message_id: message.sequence, date: Math.floor(Date.now() / 1000), chat: { id: Number(input.chat_id) }, text: message.text } });
    }
    return json(response, 404, { error: "NOT_FOUND" });
  } catch {
    return json(response, 400, { error: "INVALID_REQUEST" });
  }
}).listen(8080, "0.0.0.0", () => {
  console.log(JSON.stringify({ level: "info", service: "telegram-mock", message: "Local-only Telegram mock ready" }));
});
