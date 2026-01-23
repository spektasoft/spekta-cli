import { expect, it } from "vitest";
import { runRepl } from "./repl";

it("runRepl throws when API key is missing", async () => {
  process.env.OPENROUTER_API_KEY = "";
  await expect(runRepl()).rejects.toThrow("OPENROUTER_API_KEY is missing");
});
