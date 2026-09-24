export function registerCleanup(cleanupFn: () => Promise<void>) {
  const handler = (signal: string) => {
    void (async () => {
      try {
        await cleanupFn();
      } catch (error) {
        console.error("Cleanup failed:", error);
      } finally {
        process.exit(signal === "SIGINT" ? 130 : 0);
      }
    })();
  };

  const sigintListener = () => {
    handler("SIGINT");
  };
  const sigtermListener = () => {
    handler("SIGTERM");
  };

  process.on("SIGINT", sigintListener);
  process.on("SIGTERM", sigtermListener);

  return () => {
    process.off("SIGINT", sigintListener);
    process.off("SIGTERM", sigtermListener);
  };
}
