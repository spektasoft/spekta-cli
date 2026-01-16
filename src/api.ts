import OpenAI from "openai";

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
