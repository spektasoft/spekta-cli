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
  const response = await fetch("https://openrouter.ai/api/v1/models/user", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.statusText}`);
  }

  const data = await response.json();
  const models: OpenRouterModel[] = data.data;

  // Filter for free models only
  return models.filter(
    (m) =>
      m.pricing.prompt === "0" &&
      m.pricing.completion === "0" &&
      m.pricing.request === "0"
  );
};
