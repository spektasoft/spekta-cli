import OpenAI from "openai";

export const callAI = async (apiKey: string, model: string, prompt: string) => {
  const openai = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });

  const response = await openai.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
  });

  return response.choices[0].message.content;
};
