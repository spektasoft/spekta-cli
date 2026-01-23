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
  await fs.writeJSON(
    filePath,
    { sessionId, messages, updatedAt: new Date().toISOString() },
    { spaces: 2 },
  );
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

  return await fs.readJSON(filePath);
}

export async function listSessions(): Promise<string[]> {
  const dir = await getSessionsPath();
  if (!(await fs.pathExists(dir))) return [];

  const files = await fs.readdir(dir);
  return files
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(".json", ""));
}
