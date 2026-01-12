import OpenAI from "openai";

export const callAI = async (
  apiKey: string,
  model: string,
  prompt: string,
  config: Record<string, any> = {}
) => {
  const openai = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });

  const response = await openai.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    ...config,
  });

  return response.choices[0].message.content;
};
