import OpenAI from "openai";
import { OpenRouterModel } from "./config";
import { ChatCompletionChunk } from "openai/resources/chat/completions";
import { Stream } from "openai/streaming";

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
  reasoning?: string;
}

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

  // Strip reasoning field from history
  const sanitizedMessages = messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

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

      return (
        Number(p.prompt) === 0 &&
        Number(p.completion) === 0 &&
        Number(p.request) === 0
      );
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
): Promise<AsyncIterable<ChatCompletionChunk>> => {
  const client = clientOverride || getAIClient(apiKey);

  // Strip reasoning field from history
  const sanitizedMessages = messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  return await client.chat.completions.create({
    model,
    messages: sanitizedMessages,
    stream: true,
    ...config,
  });
};
