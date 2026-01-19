export function registerCleanup(cleanupFn: () => Promise<void>) {
  const handler = async (signal: string) => {
    try {
      await cleanupFn();
    } catch (error) {
      console.error("Cleanup failed:", error);
    } finally {
      process.exit(signal === "SIGINT" ? 130 : 0);
    }
  };
  process.on("SIGINT", () => handler("SIGINT"));
  process.on("SIGTERM", () => handler("SIGTERM"));

  return () => {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
  };
}
