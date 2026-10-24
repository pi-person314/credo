import type { WebTriggerResponse } from "@forge/api";

/** Build a web trigger response. Forge wants header values as arrays. */
export const respond = (statusCode: number, body: unknown = {}): WebTriggerResponse => ({
  statusCode,
  headers: { "Content-Type": ["application/json"] },
  body: JSON.stringify(body),
});

/** Web trigger headers arrive lowercased with array values. */
export const header = (headers: Record<string, string[]>, name: string) => headers[name.toLowerCase()]?.[0];
