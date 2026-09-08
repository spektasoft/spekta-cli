export type ProviderType = "openrouter" | "gemini";

export interface Provider {
  name: string;
  model: string;
  type?: ProviderType; // Absent = treated as "openrouter" for backward compatibility
  config?: Record<string, any>;
}

export interface ToolParamDefinition {
  description: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  params: Record<string, ToolParamDefinition>;
  xml_example: string;
}

export interface PromptMetadata {
  filename: string;
  name: string;
  description: string;
  [key: string]: any;
}

export interface ProvidersConfig {
  providers: Provider[];
}

export interface OpenRouterModel {
  id: string;
  name: string;
  pricing: {
    prompt: string;
    completion: string;
    request: string;
  };
}
