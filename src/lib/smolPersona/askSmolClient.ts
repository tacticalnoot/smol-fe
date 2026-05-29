import type { AskSmolResponse, SmolPersonaChatMessage, SmolPersonaContext } from "./types";

export async function askSmolViaApi(params: {
  context: SmolPersonaContext;
  message: string;
  chatHistory: SmolPersonaChatMessage[];
  signal?: AbortSignal;
}): Promise<AskSmolResponse> {
  const response = await fetch("/api/ask-the-smol", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      smolPersonaContext: params.context,
      message: params.message,
      chatHistory: params.chatHistory,
    }),
    signal: params.signal,
  });

  const data = (await response.json().catch(() => ({}))) as Partial<AskSmolResponse>;
  if (!response.ok) {
    return {
      ok: false,
      mode: "error",
      reply: "",
      error: data.error || `Ask the Smol API failed with ${response.status}`,
    };
  }

  return {
    ok: Boolean(data.ok),
    mode: data.mode || "error",
    reply: data.reply || "",
    error: data.error,
  };
}
