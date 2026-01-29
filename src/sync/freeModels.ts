import { fetchFreeModels } from "../api";
import { writeYaml } from "../utils/yaml";
import { HOME_PROVIDERS_FREE } from "../config";

export interface Provider {
  name: string;
  model: string;
  config?: Record<string, any>;
}

export const syncFreeModels = async (apiKey: string) => {
  const models = await fetchFreeModels(apiKey);
  if (!models || !Array.isArray(models) || models.length === 0) {
    throw new Error("No free models found on OpenRouter.");
  }
  const validModels = models.filter(
    (m) => m && typeof m.id === "string" && typeof m.name === "string",
  );
  const providers: Provider[] = validModels.map((m) => ({
    name: `[Free] ${m.name}`,
    model: m.id,
  }));

  // Save as YAML
  await writeYaml(HOME_PROVIDERS_FREE, { providers });
  return providers.length;
};
