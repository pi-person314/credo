// Rovo agent actions. Each gets the action inputs as its payload.
// TODO(A): wire each to the same code the panel resolvers use.

type Payload = { issueKey: string; [k: string]: unknown };

export async function rovoGetVerification(payload: Payload) {
  return { issueKey: payload.issueKey, status: "not implemented yet" };
}
export async function rovoAskTest(payload: Payload) {
  return { issueKey: payload.issueKey, queued: false, note: "not implemented yet" };
}
export async function rovoSetKnobs(payload: Payload) {
  return { issueKey: payload.issueKey, ok: false, note: "not implemented yet" };
}
export async function rovoFileBug(payload: Payload) {
  return { issueKey: payload.issueKey, created: false, note: "not implemented yet" };
}
