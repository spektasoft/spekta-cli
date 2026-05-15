import { GenerativeModel, GoogleGenerativeAI } from "@google/generative-ai";
import { ChatCompletionChunk } from "openai/resources/chat/completions";
import { Message } from "./api/api";

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

  const parts: Array<{ text?: string; thought?: boolean }> =
    result.response.candidates?.[0]?.content?.parts ?? [];

  let contentText = "";

  for (const part of parts) {
    if ((part as any).thought === true) {
      continue;
    }
    contentText += part.text ?? "";
  }

  // Final guard: strip any residual Gemma 4 channel token delimiters
  // that the SDK may surface as raw text rather than flagged parts.
  const text = stripGemmaThinkingTokens(contentText).trim();

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

      const parts: Array<{ text?: string; thought?: boolean }> =
        chunk.candidates?.[0]?.content?.parts ?? [];

      let contentText = "";
      const thoughtParts: Array<{ text: string }> = [];

      for (const part of parts) {
        if ((part as any).thought === true) {
          if (part.text) {
            thoughtParts.push({ text: part.text });
          }
        } else {
          contentText += part.text ?? "";
        }
      }

      // Guard against raw Gemma 4 channel token delimiters in streamed chunks.
      // Note: this sanitiser is safe to apply per-chunk because the delimiters
      // are complete tokens and will not be split across chunk boundaries by
      // the Gemini streaming API.
      contentText = stripGemmaThinkingTokens(contentText);

      // Yield a chunk only when there is at least one non-empty field to emit.
      // This guards against emitting empty chunks on candidates with no parts.
      if (contentText || thoughtParts.length > 0) {
        yield {
          id: "",
          object: "chat.completion.chunk",
          created: 0,
          model,
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                content: contentText,
                ...(thoughtParts.length > 0 && {
                  reasoning_details: thoughtParts,
                }),
              },
              finish_reason: null,
              logprobs: null,
            },
          ],
        } as unknown as ChatCompletionChunk;
      }
    }
  }

  return normalize();
};

/**
 * Removes Gemma 4 thinking channel blocks from a response string.
 *
 * Gemma 4 uses <|channel>thought\n…<channel|> delimiters to wrap
 * internal reasoning. The Gemini SDK may surface these as raw text in
 * certain response shapes. This function strips the entire block,
 * including the delimiters, and trims the result.
 *
 * The regex is non-greedy and uses the `s` (dotAll) flag so that
 * multi-line thought blocks are matched correctly.
 */
export function stripGemmaThinkingTokens(text: string): string {
  return text.replace(/<\|channel>thought\n[\s\S]*?<channel\|>/g, "");
}

export const _clearClientCache = () => clientMap.clear();
