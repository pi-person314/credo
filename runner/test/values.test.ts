import { describe, expect, it } from "vitest";
import { overall } from "../src/executor/executor.js";
import { deepEqual, getPath, resolveRefs, type Vars } from "../src/executor/values.js";

const vars: Vars = new Map<string, any>([
  ["order", { status: 201, body: { id: 7, items: [{ sku: "A" }] } }],
  ["pays", [{ status: 200, body: { status: "paid" } }, { status: 504, body: { status: "payment_failed" } }]],
]);

describe("resolveRefs", () => {
  it("keeps the type of a whole-string reference", () => {
    expect(resolveRefs({ orderId: "$order.id" }, vars)).toEqual({ orderId: 7 });
  });
  it("interpolates inline references", () => {
    expect(resolveRefs("/api/orders/$order.id", vars)).toBe("/api/orders/7");
  });
  it("indexes into parallel results", () => {
    expect(resolveRefs("$pays.1.status", vars)).toBe("payment_failed");
  });
  it("throws on unknown names", () => {
    expect(() => resolveRefs("$nope.id", vars)).toThrow(/nope/);
  });
});

describe("paths and equality", () => {
  it("reads JSONPath-ish paths", () => {
    expect(getPath({ a: { b: [{ c: 1 }] } }, "$.a.b[0].c")).toBe(1);
    expect(getPath({ a: { b: [{ c: 1 }] } }, "a.b.0.c")).toBe(1);
  });
  it("is loose on numeric strings only", () => {
    expect(deepEqual(1, "1")).toBe(true);
    expect(deepEqual({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

describe("overall", () => {
  it("FAIL wins, then anything unclear is INCONCLUSIVE", () => {
    expect(overall([{ id: "a", result: "PASS" }, { id: "b", result: "FAIL" }], false)).toBe("FAIL");
    expect(overall([{ id: "a", result: "PASS" }, { id: "b", result: "NOT_RUN" }], true)).toBe("INCONCLUSIVE");
    expect(overall([{ id: "a", result: "PASS" }], true)).toBe("INCONCLUSIVE");
    expect(overall([{ id: "a", result: "PASS" }], false)).toBe("PASS");
  });
});
