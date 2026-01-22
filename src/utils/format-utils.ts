import prettier from "prettier";

export async function formatFile(
  filePath: string,
  content: string,
): Promise<string> {
  try {
    // Resolve the configuration based on the file location
    const options = await prettier.resolveConfig(filePath);

    // Format the entire file, inferring the parser from the file extension
    return await prettier.format(content, {
      ...options,
      filepath: filePath,
    });
  } catch (err: any) {
    // Graceful degradation: log the warning but return original content
    // This ensures the tool remains runnable even if formatting fails
    console.warn(
      `Prettier formatting failed for ${filePath}: ${err.message}. Returning original content.`,
    );
    return content;
  }
}
