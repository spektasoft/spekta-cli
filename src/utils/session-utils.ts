import fs from "fs-extra";
import path from "path";
import { Message } from "../api/api";
import { generateId, getSessionsPath } from "../fs/fs-manager";

export const generateSessionId = generateId;

export async function saveSession(
  sessionId: string,
  messages: Message[],
): Promise<void> {
  const dir = await getSessionsPath();
  const filePath = path.join(dir, `${sessionId}.json`);
  const tmpFilePath = path.join(dir, `${sessionId}.json.tmp`);

  // Write to a temporary file first
  await fs.writeJSON(
    tmpFilePath,
    { sessionId, messages, updatedAt: new Date().toISOString() },
    { spaces: 2 },
  );

  // Atomically replace the existing file
  await fs.rename(tmpFilePath, filePath);
}

export async function loadSession(sessionId: string): Promise<{
  sessionId: string;
  messages: Message[];
  updatedAt: string;
} | null> {
  const dir = await getSessionsPath();
  const filePath = path.join(dir, `${sessionId}.json`);

  if (!(await fs.pathExists(filePath))) {
    return null;
  }

  const data = (await fs.readJSON(filePath)) as Record<string, unknown>;

  // Validate that messages conform to the Message interface
  if (!data || !Array.isArray(data.messages)) {
    console.warn(`Invalid messages format in session ${sessionId}`);
    return null;
  }

  // Ensure each message has the required fields and handle optional reasoning
  const rawMessages = data.messages as unknown[];
  const validatedMessages: Message[] = [];

  for (const item of rawMessages) {
    if (
      typeof item === "object" &&
      item !== null &&
      "role" in item &&
      "content" in item
    ) {
      const msg = item as {
        role: unknown;
        content: unknown;
        reasoning?: unknown;
      };
      if (
        (msg.role === "system" ||
          msg.role === "user" ||
          msg.role === "assistant") &&
        typeof msg.content === "string"
      ) {
        const validatedMessage: Message = {
          role: msg.role,
          content: msg.content,
        };
        if (typeof msg.reasoning === "string") {
          validatedMessage.reasoning = msg.reasoning;
        }
        validatedMessages.push(validatedMessage);
        continue;
      }
    }
    console.warn(
      `Invalid message format in session ${sessionId}: missing required fields`,
    );
  }

  if (validatedMessages.length !== rawMessages.length) {
    console.warn(
      `Some messages in session ${sessionId} were invalid and removed`,
    );
  }

  return {
    sessionId: typeof data.sessionId === "string" ? data.sessionId : sessionId,
    messages: validatedMessages,
    updatedAt:
      typeof data.updatedAt === "string"
        ? data.updatedAt
        : new Date().toISOString(),
  };
}

export async function listSessions(): Promise<string[]> {
  const dir = await getSessionsPath();
  if (!(await fs.pathExists(dir))) return [];

  const files = await fs.readdir(dir);
  return files
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(".json", ""));
}
