import { expect, it } from "vitest";
import { promptReplProviderSelection } from "./repl";

it("throws if no providers are available", async () => {
  await expect(promptReplProviderSelection("test", [])).rejects.toThrow(
    "No AI providers available",
  );
});
