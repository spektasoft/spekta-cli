import OpenAI from "openai";

let openai: OpenAI | null = null;

const getClient = (apiKey: string): OpenAI => {
  if (!openai) {
    openai = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
    });
  }
  return openai;
};

export const callAI = async (
  apiKey: string,
  model: string,
  prompt: string,
  config: Record<string, any> = {}
): Promise<string> => {
  const client = getClient(apiKey);

  const response = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    ...config,
  });

  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new Error("The AI provider returned an empty response.");
  }

  return content;
};
