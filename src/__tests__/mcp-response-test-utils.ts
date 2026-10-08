export function serializeMcpToolReply(
  requestId: string | number | null,
  result: {
    isError?: boolean;
    content: Array<{ type: string; text: string }>;
  },
): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id: requestId, result })}\n`;
}
