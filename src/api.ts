import OpenAI from "openai";
import { OpenRouterModel } from "./config";

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
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
  clientOverride?: OpenAI
): Promise<string> => {
  const client = clientOverride || getAIClient(apiKey);

  const response = await client.chat.completions.create({
    model,
    messages,
    ...config,
  });

  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new Error("The AI provider returned an empty response.");
  }

  return content;
};

export const fetchFreeModels = async (
  apiKey: string
): Promise<OpenRouterModel[]> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
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

      // Handle various data types and edge cases for pricing values
      if (!p || typeof p !== "object") {
        return false;
      }

      // Convert to strings and normalize for comparison
      const prompt = String(p.prompt ?? "");
      const completion = String(p.completion ?? "");
      const request = String(p.request ?? "");

      // Check if all pricing values are zero (including variations like "0.0", "0.00", etc.)
      const isZero = (val: string) => /^0(?:\.0*)?$/.test(val.trim());

      return isZero(prompt) && isZero(completion) && isZero(request);
    });
  } finally {
    clearTimeout(timeout);
  }
};
