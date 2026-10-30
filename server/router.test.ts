import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createRouter, HttpError } from "./router.ts";

const post = (path: string, body: string) =>
  new Request(`http://127.0.0.1${path}`, { method: "POST", body });

describe("createRouter", () => {
  const router = createRouter();
  router.route("POST", "/api/echo", z.object({ n: z.number() }), (input) => ({
    doubled: input.n * 2,
  }));
  router.route("GET", "/api/query", z.object({ q: z.string() }), (input) => ({ q: input.q }));
  router.route("GET", "/api/refused", z.object({}), () => {
    throw new HttpError(409, "still in use");
  });
  router.route("GET", "/api/boom", z.object({}), () => {
    throw new Error("boom");
  });

  it("validates the JSON body and passes the parsed value to the handler", async () => {
    const response = await router.handle(post("/api/echo", '{"n":4}'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ doubled: 8 });
  });

  it("answers 400 when the body fails the schema", async () => {
    const response = await router.handle(post("/api/echo", '{"n":"four"}'));
    expect(response.status).toBe(400);
  });

  it("answers 400 when the body is not JSON", async () => {
    const response = await router.handle(post("/api/echo", "{not json"));
    expect(response.status).toBe(400);
  });

  it("validates the query string on GET", async () => {
    const ok = await router.handle(new Request("http://127.0.0.1/api/query?q=hi"));
    expect(await ok.json()).toEqual({ q: "hi" });
    const bad = await router.handle(new Request("http://127.0.0.1/api/query"));
    expect(bad.status).toBe(400);
  });

  it("answers 404 for an unknown path and 405 for a wrong method", async () => {
    expect((await router.handle(new Request("http://127.0.0.1/api/none"))).status).toBe(404);
    expect((await router.handle(post("/api/query", "{}"))).status).toBe(405);
  });

  it("answers 500 without the error text when a handler throws", async () => {
    const response = await router.handle(new Request("http://127.0.0.1/api/boom"));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("boom");
  });

  it("answers with the status and message of an HttpError", async () => {
    const response = await router.handle(new Request("http://127.0.0.1/api/refused"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "still in use" });
  });
});
