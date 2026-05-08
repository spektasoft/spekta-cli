import { GenerativeModel, GoogleGenerativeAI } from "@google/generative-ai";
import { ChatCompletionChunk } from "openai/resources/chat/completions";
import { Message } from "./api";

const clientMap = new Map<string, GoogleGenerativeAI>();

const getGeminiClient = (apiKey: string): GoogleGenerativeAI => {
  let client = clientMap.get(apiKey);
  if (!client) {
    client = new GoogleGenerativeAI(apiKey);
    clientMap.set(apiKey, client);
  }
  return client;
};

/**
 * Converts the internal Message[] format to the format expected by the
 * Gemini SDK. The system prompt is extracted and passed separately.
 */
function buildGeminiHistory(messages: Message[]): {
  systemInstruction: string | undefined;
  history: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
  lastUserMessage: string;
} {
  let systemInstruction: string | undefined;
  const history: Array<{
    role: "user" | "model";
    parts: Array<{ text: string }>;
  }> = [];
  let lastUserMessage = "";

  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction = msg.content;
      continue;
    }
    if (msg.role === "assistant") {
      history.push({ role: "model", parts: [{ text: msg.content }] });
    } else {
      lastUserMessage = msg.content;
      // Only push to history if it is not the final user turn
      if (msg !== messages[messages.length - 1]) {
        history.push({ role: "user", parts: [{ text: msg.content }] });
      }
    }
  }

  return { systemInstruction, history, lastUserMessage };
}

function getModel(
  client: GoogleGenerativeAI,
  model: string,
  systemInstruction: string | undefined,
  config: Record<string, any>,
): GenerativeModel {
  return client.getGenerativeModel({
    model,
    systemInstruction,
    generationConfig: config,
  });
}

export const callGemini = async (
  apiKey: string,
  model: string,
  messages: Message[],
  config: Record<string, any> = {},
): Promise<string> => {
  const client = getGeminiClient(apiKey);
  const { systemInstruction, history, lastUserMessage } =
    buildGeminiHistory(messages);

  const generativeModel = getModel(client, model, systemInstruction, config);
  const chat = generativeModel.startChat({ history });
  const result = await chat.sendMessage(lastUserMessage);
  const text = result.response.text();

  if (!text) {
    throw new Error("The Gemini provider returned an empty response.");
  }

  return text;
};

/**
 * Wraps the Gemini streaming response in an AsyncIterable that yields
 * objects shaped like OpenAI ChatCompletionChunk so that repl.ts
 * requires no modification.
 */
export const callGeminiStream = async (
  apiKey: string,
  model: string,
  messages: Message[],
  config: Record<string, any> = {},
  signal?: AbortSignal,
): Promise<AsyncIterable<ChatCompletionChunk>> => {
  const client = getGeminiClient(apiKey);
  const { systemInstruction, history, lastUserMessage } =
    buildGeminiHistory(messages);

  const generativeModel = getModel(client, model, systemInstruction, config);
  const chat = generativeModel.startChat({ history });
  const streamResult = await chat.sendMessageStream(lastUserMessage);

  async function* normalize(): AsyncIterable<ChatCompletionChunk> {
    for await (const chunk of streamResult.stream) {
      if (signal?.aborted) {
        const err = new Error("AbortError");
        err.name = "AbortError";
        throw err;
      }
      const text = chunk.text();
      // Emit a minimal object that satisfies the shape consumed by repl.ts
      yield {
        id: "",
        object: "chat.completion.chunk",
        created: 0,
        model,
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: text },
            finish_reason: null,
            logprobs: null,
          },
        ],
      } as unknown as ChatCompletionChunk;
    }
  }

  return normalize();
};

export const _clearClientCache = () => clientMap.clear();
