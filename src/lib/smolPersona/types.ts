export type ChatRole = "user" | "assistant";

export interface SmolPersonaChatMessage {
  role: ChatRole;
  content: string;
}

export interface SmolPersonaContext {
  id: string;
  title: string;
  creator?: string;
  artist?: string;
  tags: string[];
  styleText?: string;
  lyricsText?: string;
  promptText?: string;
  imageUrl?: string;
  audioUrl?: string;
  rawSummary?: string;
  sourceFields: string[];
}

export interface SmolPersonaPromptPackage {
  systemPrompt: string;
  contextBlock: string;
  finalPrompt: string;
  userMessage: string;
  chatHistory: SmolPersonaChatMessage[];
}

export interface AskSmolResponse {
  ok: boolean;
  mode: "llm" | "preview" | "error";
  reply: string;
  error?: string;
}
