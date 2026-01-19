export function registerCleanup(cleanupFn: () => Promise<void>) {
  const handler = async () => {
    await cleanupFn();
    process.exit(130);
  };
  process.on("SIGINT", handler);
  return () => process.off("SIGINT", handler);
}
