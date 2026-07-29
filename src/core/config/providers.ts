import { readYaml } from "../../utils/yaml";
import { getEnv } from "./env.js";
import { HOME_PROVIDERS_FREE, HOME_PROVIDERS_USER } from "./paths.js";
import { Provider, ProvidersConfig } from "./types.js";

export const getProviders = async (): Promise<ProvidersConfig> => {
  const env = await getEnv();
  const disableFree = env.SPEKTA_DISABLE_FREE_MODELS === "true";

  const safeRead = async (filePath: string): Promise<ProvidersConfig> => {
    try {
      const data = await readYaml<ProvidersConfig>(filePath);
      return data || { providers: [] };
    } catch (err: any) {
      console.warn(`Warning: ${err.message}`);
      return { providers: [] };
    }
  };

  const [userRes, freeRes] = await Promise.allSettled([
    safeRead(HOME_PROVIDERS_USER),
    !disableFree
      ? safeRead(HOME_PROVIDERS_FREE)
      : Promise.resolve({ providers: [] }),
  ]);

  const userProviders: Provider[] =
    userRes.status === "fulfilled" ? userRes.value.providers : [];
  const freeProviders: Provider[] =
    freeRes.status === "fulfilled" ? freeRes.value.providers : [];

  const providers = [...userProviders, ...freeProviders];
  if (providers.length === 0) {
    console.warn(
      "Notice: No providers configured. Run 'spekta sync' to fetch free models.",
    );
  }

  return { providers };
};
