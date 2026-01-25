import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";
import {
  saveSession,
  loadSession,
  listSessions,
  generateSessionId,
} from "./session-utils";
import { getSessionsPath } from "../fs-manager";

// Mock the fs-manager module
vi.mock("../fs-manager", () => ({
  generateId: () => "test-session-id",
  getSessionsPath: vi.fn(),
}));

describe("Session Utils - Atomic Write", () => {
  // Add random suffix to ensure unique path per test file execution
  const tmpDir = path.join(
    os.tmpdir(),
    `session-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
  );
  const mockSessionId = "test-session-123";
  const mockMessages = [
    { role: "user", content: "Hello" } as any,
    { role: "assistant", content: "Hi there!" } as any,
  ];

  beforeEach(async () => {
    // Create a temporary directory for tests
    await fs.ensureDir(tmpDir);
    vi.mocked(getSessionsPath).mockResolvedValue(tmpDir);
  });

  afterEach(async () => {
    // 1. Restore mocks FIRST so fs methods (like remove) work correctly
    vi.restoreAllMocks();

    // 2. Clean up temporary directory using the real filesystem
    await fs.remove(tmpDir);
  });

  describe("saveSession - Atomic Write", () => {
    it("should write to temporary file first, then rename", async () => {
      const mockWriteJSON = vi.spyOn(fs, "writeJSON").mockResolvedValue();
      const mockRename = vi.spyOn(fs, "rename").mockResolvedValue();

      await saveSession(mockSessionId, mockMessages);

      // Verify writeJSON was called with tmp file
      expect(mockWriteJSON).toHaveBeenCalledTimes(1);
      const tmpPath = path.join(tmpDir, `${mockSessionId}.json.tmp`);
      expect(mockWriteJSON).toHaveBeenCalledWith(
        tmpPath,
        expect.objectContaining({
          sessionId: mockSessionId,
          messages: mockMessages,
          updatedAt: expect.any(String),
        }),
        { spaces: 2 },
      );

      // Verify rename was called with tmp to final
      expect(mockRename).toHaveBeenCalledTimes(1);
      const finalPath = path.join(tmpDir, `${mockSessionId}.json`);
      expect(mockRename).toHaveBeenCalledWith(tmpPath, finalPath);
    });

    it("should handle writeJSON errors gracefully", async () => {
      const mockWriteJSON = vi
        .spyOn(fs, "writeJSON")
        .mockRejectedValue(new Error("Disk full"));

      await expect(saveSession(mockSessionId, mockMessages)).rejects.toThrow(
        "Disk full",
      );
      expect(mockWriteJSON).toHaveBeenCalledTimes(1);
    });

    it("should preserve original file if write fails", async () => {
      // Create an existing valid session file (Uses REAL fs because mocks are restored)
      const originalData = {
        sessionId: mockSessionId,
        messages: [{ role: "user", content: "Original" }] as any,
        updatedAt: new Date().toISOString(),
      };
      const finalPath = path.join(tmpDir, `${mockSessionId}.json`);
      await fs.writeJSON(finalPath, originalData, { spaces: 2 });

      // Mock writeJSON to fail
      const mockWriteJSON = vi
        .spyOn(fs, "writeJSON")
        .mockRejectedValue(new Error("Write failed"));

      // Attempt to save new session
      await expect(saveSession(mockSessionId, mockMessages)).rejects.toThrow(
        "Write failed",
      );

      // Verify original file still exists and contains original data
      // We must check if path exists using the real FS (which is fine, because spy only affects writeJSON)
      expect(await fs.pathExists(finalPath)).toBe(true);
      const savedData = await fs.readJSON(finalPath);
      expect(savedData.messages).toEqual(originalData.messages);
      expect(savedData.updatedAt).toBe(originalData.updatedAt);
    });

    it("should handle rename errors gracefully", async () => {
      const mockWriteJSON = vi.spyOn(fs, "writeJSON").mockResolvedValue();
      const mockRename = vi
        .spyOn(fs, "rename")
        .mockRejectedValue(new Error("Rename failed"));

      await expect(saveSession(mockSessionId, mockMessages)).rejects.toThrow(
        "Rename failed",
      );
      expect(mockWriteJSON).toHaveBeenCalledTimes(1);
      expect(mockRename).toHaveBeenCalledTimes(1);
    });
  });

  describe("loadSession", () => {
    it("should load existing session", async () => {
      const sessionData = {
        sessionId: mockSessionId,
        messages: mockMessages,
        updatedAt: new Date().toISOString(),
      };
      const filePath = path.join(tmpDir, `${mockSessionId}.json`);
      // Ensure this uses real FS by virtue of restoreAllMocks in previous afterEach
      await fs.writeJSON(filePath, sessionData, { spaces: 2 });

      const result = await loadSession(mockSessionId);

      expect(result).toEqual(sessionData);
    });

    it("should return null for non-existent session", async () => {
      const result = await loadSession("non-existent");
      expect(result).toBeNull();
    });

    it("should handle JSON parsing errors", async () => {
      const filePath = path.join(tmpDir, `${mockSessionId}.json`);
      await fs.writeFile(filePath, "invalid json");

      await expect(loadSession(mockSessionId)).rejects.toThrow();
    });

    it("should load session with reasoning field", async () => {
      const sessionData = {
        sessionId: mockSessionId,
        messages: [
          { role: "user", content: "Hello" },
          {
            role: "assistant",
            content: "Hi there!",
            reasoning: "The user greeted me, so I should respond politely.",
          },
        ],
        updatedAt: new Date().toISOString(),
      };
      const filePath = path.join(tmpDir, `${mockSessionId}.json`);
      await fs.writeJSON(filePath, sessionData, { spaces: 2 });

      const result = await loadSession(mockSessionId);

      expect(result).toEqual(sessionData);
      expect(result!.messages[1].reasoning).toBe(
        sessionData.messages[1].reasoning,
      );
    });

    it("should handle session with missing reasoning field", async () => {
      const sessionData = {
        sessionId: mockSessionId,
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" }, // No reasoning field
        ],
        updatedAt: new Date().toISOString(),
      };
      const filePath = path.join(tmpDir, `${mockSessionId}.json`);
      await fs.writeJSON(filePath, sessionData, { spaces: 2 });

      const result = await loadSession(mockSessionId);

      expect(result).toEqual(sessionData);
      expect(result!.messages[1].reasoning).toBeUndefined();
    });

    it("should filter out messages with missing required fields", async () => {
      const sessionData = {
        sessionId: mockSessionId,
        messages: [
          { role: "user", content: "Hello" }, // Valid
          { role: "assistant" }, // Missing content
          { content: "Hi there!" }, // Missing role
          { role: "assistant", content: "Good!" }, // Valid
        ],
        updatedAt: new Date().toISOString(),
      };
      const filePath = path.join(tmpDir, `${mockSessionId}.json`);
      await fs.writeJSON(filePath, sessionData, { spaces: 2 });

      const result = await loadSession(mockSessionId);

      // Should only return valid messages
      expect(result).not.toBeNull();
      expect(result!.messages).toHaveLength(2);
      expect(result!.messages[0]).toEqual({ role: "user", content: "Hello" });
      expect(result!.messages[1]).toEqual({
        role: "assistant",
        content: "Good!",
      });
    });

    it("should handle session with invalid messages format", async () => {
      const sessionData = {
        sessionId: mockSessionId,
        messages: "not an array", // Invalid messages format
        updatedAt: new Date().toISOString(),
      };
      const filePath = path.join(tmpDir, `${mockSessionId}.json`);
      await fs.writeJSON(filePath, sessionData, { spaces: 2 });

      const result = await loadSession(mockSessionId);

      expect(result).toBeNull();
    });

    it("should handle session with missing sessionId and updatedAt", async () => {
      const sessionData = {
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ],
      };
      const filePath = path.join(tmpDir, `${mockSessionId}.json`);
      await fs.writeJSON(filePath, sessionData, { spaces: 2 });

      const result = await loadSession(mockSessionId);

      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe(mockSessionId); // Fallback to provided sessionId
      expect(result!.updatedAt).toBeDefined(); // Should have generated timestamp
    });

    it("should preserve original sessionId if present", async () => {
      const sessionId = "original-session-id";
      const sessionData = {
        sessionId,
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ],
        updatedAt: new Date().toISOString(),
      };
      const filePath = path.join(tmpDir, `${mockSessionId}.json`);
      await fs.writeJSON(filePath, sessionData, { spaces: 2 });

      const result = await loadSession(mockSessionId);

      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe(sessionId); // Should preserve original sessionId
    });
  });

  describe("listSessions", () => {
    it("should list all session files", async () => {
      // Create multiple session files
      const sessions = ["session1", "session2", "session3"];
      for (const sessionId of sessions) {
        const filePath = path.join(tmpDir, `${sessionId}.json`);
        await fs.writeJSON(filePath, {
          sessionId,
          messages: [],
          updatedAt: new Date().toISOString(),
        });
      }

      const result = await listSessions();

      expect(result).toHaveLength(3);
      expect(result.sort()).toEqual(sessions.sort());
    });

    it("should ignore non-JSON files", async () => {
      // Create mix of JSON and non-JSON files
      const jsonFile = path.join(tmpDir, "session1.json");
      const txtFile = path.join(tmpDir, "session2.txt");
      const tmpFile = path.join(tmpDir, "session3.json.tmp");

      await fs.writeJSON(jsonFile, { sessionId: "session1", messages: [] });
      await fs.writeFile(txtFile, "text file");
      await fs.writeJSON(tmpFile, { sessionId: "session3", messages: [] });

      const result = await listSessions();

      expect(result).toEqual(["session1"]);
    });

    it("should return empty array if directory does not exist", async () => {
      // Ensure directory doesn't exist
      const emptyDir = path.join(tmpDir, "non-existent");
      vi.mocked(getSessionsPath).mockResolvedValue(emptyDir);

      const result = await listSessions();
      expect(result).toEqual([]);
    });

    it("should handle directory read errors", async () => {
      const mockReaddir = vi
        .spyOn(fs, "readdir")
        .mockRejectedValue(new Error("Read failed"));

      await expect(listSessions()).rejects.toThrow("Read failed");
    });
  });

  describe("generateSessionId", () => {
    it("should return a session ID", () => {
      const result = generateSessionId();
      expect(typeof result).toBe("string");
      expect(result).toBeTruthy();
    });
  });
});
