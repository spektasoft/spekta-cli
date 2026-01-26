import fs from "fs-extra";
import path from "path";
import { Message } from "../api";
import { generateId, getSessionsPath } from "../fs-manager";

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

  const data = await fs.readJSON(filePath);

  // Validate that messages conform to the Message interface
  if (!data.messages || !Array.isArray(data.messages)) {
    console.warn(`Invalid messages format in session ${sessionId}`);
    return null;
  }

  // Ensure each message has the required fields and handle optional reasoning
  const validatedMessages = data.messages
    .map((message: any) => {
      if (!message.role || !message.content) {
        console.warn(
          `Invalid message format in session ${sessionId}: missing required fields`,
        );
        return null;
      }

      // Create a new message object with validated structure
      const validatedMessage: Message = {
        role: message.role,
        content: message.content,
      };

      // Add reasoning field if present (it's optional)
      if (message.reasoning !== undefined) {
        validatedMessage.reasoning = message.reasoning;
      }

      return validatedMessage;
    })
    .filter(Boolean); // Filter out any null messages

  if (validatedMessages.length !== data.messages.length) {
    console.warn(
      `Some messages in session ${sessionId} were invalid and removed`,
    );
  }

  return {
    sessionId: data.sessionId || sessionId,
    messages: validatedMessages,
    updatedAt: data.updatedAt || new Date().toISOString(),
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
