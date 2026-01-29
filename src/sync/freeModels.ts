import { fetchFreeModels } from "../api";
import { HOME_PROVIDERS_FREE, Provider } from "../config";
import { writeYaml } from "../utils/yaml";

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
