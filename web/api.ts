import { useCallback, useEffect, useState } from "react";
import { plainMessage } from "./formErrors.ts";

/** A failed API call; `message` is fit to show the user. */
export class ApiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

interface Failure {
  error?: string;
  issues?: { path?: (string | number)[]; message?: string }[];
}

const describe = ({ error, issues }: Failure): string => {
  const details = (issues ?? []).map(
    (issue) => `${issue.path?.join(".") || "value"}: ${issue.message ?? "invalid"}`,
  );
  return [error ?? "request failed", ...details].join(". ");
};

/** Calls the REST API. GET and DELETE carry their input in `query`, the other methods in `body`. */
export async function api<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  { query, body }: { query?: Record<string, string>; body?: unknown } = {},
): Promise<T> {
  const url = query ? `${path}?${new URLSearchParams(query)}` : path;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("The server did not answer. Is gbi still running?");
  }
  const payload = (await response.json().catch(() => ({}))) as Failure;
  if (!response.ok) throw new ApiError(describe(payload), response.status);
  return payload as T;
}

/** The text to show for a failure, in plain words: no validator text and no code names. */
export const messageOf = (error: unknown): string =>
  error instanceof Error ? plainMessage(error.message) : "Something went wrong.";

export interface Loaded<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => void;
  /** Replaces the loaded data, for example with a response that carries the new state. */
  set: (data: T) => void;
}

/** Loads a GET resource, and again when `reload` is called. */
export function useLoad<T>(path: string): Loaded<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  // `tick` is not read inside the effect: changing it is how `reload` asks for a new run.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    let live = true;
    setLoading(true);
    api<T>("GET", path).then(
      (result) => {
        if (!live) return;
        setData(result);
        setError(undefined);
        setLoading(false);
      },
      (failure) => {
        if (!live) return;
        setError(messageOf(failure));
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, set: setData };
}
