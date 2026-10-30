import type { ZodType } from "zod";

export type Method = "GET" | "POST" | "PUT" | "DELETE";

type Run = (request: Request) => Promise<Response>;

// GET and DELETE carry their input in the query string, the other methods in a JSON body.
const QUERY_METHODS: readonly string[] = ["GET", "DELETE"];

const failure = (status: number, error: string, issues?: unknown): Response =>
  Response.json({ error, issues }, { status });

async function readInput(request: Request): Promise<unknown> {
  if (QUERY_METHODS.includes(request.method)) {
    return Object.fromEntries(new URL(request.url).searchParams);
  }
  const text = await request.text();
  return text === "" ? undefined : JSON.parse(text);
}

/** A small exact-path router over web-standard `Request` and `Response`. */
export function createRouter() {
  const routes = new Map<string, Map<string, Run>>();

  /**
   * Registers a route.
   *
   * @param method HTTP method.
   * @param path Exact path, for example `/api/health`.
   * @param schema Validates the request input: the query object for GET and DELETE, the JSON body otherwise.
   * @param handler Receives the validated input and returns a JSON-serialisable value.
   */
  function route<T>(
    method: Method,
    path: string,
    schema: ZodType<T>,
    handler: (input: T) => unknown | Promise<unknown>,
  ): void {
    const run: Run = async (request) => {
      let raw: unknown;
      try {
        raw = await readInput(request);
      } catch {
        return failure(400, "request body is not valid JSON");
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success) return failure(400, "invalid request", parsed.error.issues);
      return Response.json(await handler(parsed.data));
    };
    const methods = routes.get(path) ?? new Map<string, Run>();
    methods.set(method, run);
    routes.set(path, methods);
  }

  async function handle(request: Request): Promise<Response> {
    const methods = routes.get(new URL(request.url).pathname);
    if (!methods) return failure(404, "not found");
    const run = methods.get(request.method);
    if (!run) return failure(405, "method not allowed");
    try {
      return await run(request);
    } catch (error) {
      console.error(error);
      return failure(500, "internal error");
    }
  }

  return { route, handle };
}
