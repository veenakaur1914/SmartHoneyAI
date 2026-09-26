type TelegramUpdate = {
  update_id?: number;
  message?: {
    text?: string;
    chat?: { id?: number; type?: string; title?: string; username?: string; first_name?: string };
  };
};

export function matchingTelegramChat(updates: TelegramUpdate[], code: string) {
  const command = new RegExp(`^/connect(?:@[A-Za-z0-9_]{5,32})? ${code}$`);
  const match = [...updates].reverse().find((update) => {
    const chat = update.message?.chat;
    return command.test(update.message?.text?.trim() ?? "")
      && typeof chat?.id === "number"
      && ["private", "group", "supergroup"].includes(chat.type ?? "");
  })?.message?.chat;
  return match && typeof match.id === "number"
    ? { id: match.id, type: match.type ?? "unknown", title: match.title ?? match.username ?? match.first_name ?? "Telegram chat" }
    : undefined;
}

export function telegramProviderError(status: number) {
  if (status === 400) return "Telegram rejected the saved chat. Reconnect the chat and confirm the bot can post there.";
  if (status === 401) return "Telegram rejected the bot token. Replace the server bot token and redeploy the API and worker.";
  if (status === 403) return "Telegram cannot post to this chat. Unblock the bot or restore its group posting permission, then reconnect.";
  if (status === 429) return "Telegram is rate-limiting this bot. Wait briefly and send the test again.";
  return `Telegram delivery failed with HTTP ${status}.`;
}

export async function telegramApi<T>(botToken: string, method: string, body?: Record<string, unknown>, baseUrl = "https://api.telegram.org"): Promise<T> {
  const response = await fetch(`${baseUrl}/bot${botToken}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(telegramProviderError(response.status));
  const result = await response.json() as { ok?: boolean; result?: T; description?: string };
  if (!result.ok || result.result === undefined) throw new Error(result.description ? `Telegram request failed: ${result.description.slice(0, 160)}` : "Telegram request failed");
  return result.result;
}

export type { TelegramUpdate };
