import OpenAI from "openai";
import { ChatCompletionChunk } from "openai/resources/chat/completions";
import { OpenRouterModel, Provider } from "./config";
import { callGemini, callGeminiStream } from "./gemini-adapter";

// Extension interface for OpenAI streaming chunk with reasoning_details
export interface ChatCompletionChunkWithReasoning {
  choices: Array<{
    delta: {
      reasoning_details?: Array<{
        text?: string;
      }>;
      content: string;
    };
  }>;
}

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
  reasoning?: string;
}

type SanitizedMessage = Omit<Message, "reasoning">;

const clientMap = new Map<string, OpenAI>();

export const getAIClient = (apiKey: string): OpenAI => {
  let client = clientMap.get(apiKey);
  if (!client) {
    client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
    });
    clientMap.set(apiKey, client);
  }
  return client;
};

export const callAI = async (
  apiKey: string,
  model: string,
  messages: Message[],
  config: Record<string, any> = {},
  // Best practice: Allow injection for testing
  clientOverride?: OpenAI,
): Promise<string> => {
  const client = clientOverride || getAIClient(apiKey);

  // Use destructuring to exclude reasoning while preserving all other fields
  const sanitizedMessages: SanitizedMessage[] = messages.map(
    ({ reasoning, ...rest }) => rest,
  );

  const response = await client.chat.completions.create({
    model,
    messages: sanitizedMessages,
    ...config,
  });

  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new Error("The AI provider returned an empty response.");
  }

  return content;
};

export const fetchFreeModels = async (
  apiKey: string,
): Promise<OpenRouterModel[]> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/models/user", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const data = await response.json();
    if (!data?.data || !Array.isArray(data.data)) {
      throw new Error("Invalid response format from OpenRouter.");
    }

    return data.data.filter((m: any) => {
      const p = m.pricing;
      if (!p || typeof p !== "object") return false;

      return Number(p.prompt) === 0 && Number(p.completion) === 0;
    });
  } finally {
    clearTimeout(timeout);
  }
};

export const callAIStream = async (
  apiKey: string,
  model: string,
  messages: Message[],
  config: Record<string, any> = {},
  // Best practice: Allow injection for testing
  clientOverride?: OpenAI,
  signal?: AbortSignal, // Add signal parameter
): Promise<AsyncIterable<ChatCompletionChunk>> => {
  const client = clientOverride || getAIClient(apiKey);

  // Use destructuring to exclude reasoning while preserving all other fields
  const sanitizedMessages: SanitizedMessage[] = messages.map(
    ({ reasoning, ...rest }) => rest,
  );

  return await client.chat.completions.create(
    {
      model,
      messages: sanitizedMessages,
      stream: true,
      ...config,
    },
    { signal },
  );
};

/**
 * Resolves the correct API key for a given provider type from process.env.
 * Throws a descriptive error if the required key is absent.
 */
export function resolveApiKey(provider: Provider): string {
  const type = provider.type ?? "openrouter";
  if (type === "gemini") {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("Configuration Error: Missing GEMINI_API_KEY");
    return key;
  }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("Configuration Error: Missing OPENROUTER_API_KEY");
  return key;
}

/**
 * Provider-aware replacement for callAI.
 * Routes to the correct backend based on provider.type.
 */
export const callAIWithProvider = async (
  provider: Provider,
  messages: Message[],
  config: Record<string, any> = {},
  clientOverride?: OpenAI,
): Promise<string> => {
  const type = provider.type ?? "openrouter";
  const apiKey = resolveApiKey(provider);

  if (type === "gemini") {
    return callGemini(apiKey, provider.model, messages, config);
  }

  return callAI(apiKey, provider.model, messages, config, clientOverride);
};

/**
 * Provider-aware replacement for callAIStream.
 * Routes to the correct backend based on provider.type.
 */
export const callAIStreamWithProvider = async (
  provider: Provider,
  messages: Message[],
  config: Record<string, any> = {},
  clientOverride?: OpenAI,
  signal?: AbortSignal,
): Promise<AsyncIterable<ChatCompletionChunk>> => {
  const type = provider.type ?? "openrouter";
  const apiKey = resolveApiKey(provider);

  if (type === "gemini") {
    return callGeminiStream(apiKey, provider.model, messages, config, signal);
  }

  return callAIStream(
    apiKey,
    provider.model,
    messages,
    config,
    clientOverride,
    signal,
  );
};
