import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
}));

vi.mock("./proxy-security", () => ({
  isCommandSafe: vi.fn(),
  redactSecrets: (value: string) => value,
}));

import { confirm } from "@inquirer/prompts";
import { isCommandSafe } from "./proxy-security";
import { authorizeProxyCommand } from "./proxy-authorization";

describe("authorizeProxyCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("strips the force flag and bypasses safety classification", async () => {
    vi.mocked(isCommandSafe).mockReturnValue(false);

    await expect(
      authorizeProxyCommand("git", ["status", "--spekta-force"]),
    ).resolves.toEqual(["status"]);

    expect(isCommandSafe).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("allows safe commands without prompting", async () => {
    vi.mocked(isCommandSafe).mockReturnValue(true);

    await expect(authorizeProxyCommand("git", ["status"])).resolves.toEqual([
      "status",
    ]);

    expect(confirm).not.toHaveBeenCalled();
  });

  it("allows forced unsafe commands without prompting", async () => {
    vi.mocked(isCommandSafe).mockReturnValue(false);

    await expect(
      authorizeProxyCommand("git", ["reset", "--hard", "--spekta-force"]),
    ).resolves.toEqual(["reset", "--hard"]);

    expect(confirm).not.toHaveBeenCalled();
  });
});
