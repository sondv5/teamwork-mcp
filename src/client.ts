import type { Credential } from "./credentials.js";

export type QueryValue =
  | string
  | number
  | boolean
  | undefined
  | null
  | Array<string | number>;

export type Query = Record<string, QueryValue>;

export class TeamworkError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "TeamworkError";
    this.status = status;
  }
}

const BASE_PATH = "/projects/api/v3";

/** Minimal surface exposed to tools. The API key never leaves TeamworkClient. */
export interface TeamworkApi {
  readonly site: string;
  get<T>(path: string, query?: Query): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  delete<T>(path: string, query?: Query): Promise<T>;
  request<T>(method: string, path: string, query?: Query, body?: unknown): Promise<T>;
}

export class TeamworkClient implements TeamworkApi {
  readonly site: string;
  #key: string;

  constructor(cred: Credential) {
    this.site = cred.site;
    this.#key = cred.key;
  }

  get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>("GET", path, query);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, undefined, body);
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", path, undefined, body);
  }

  delete<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>("DELETE", path, query);
  }

  async request<T>(method: string, path: string, query?: Query, body?: unknown): Promise<T> {
    const normalized = normalizePath(path);
    const url = new URL(`https://${this.site}${normalized}`);
    for (const [name, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(name, Array.isArray(value) ? value.join(",") : String(value));
    }

    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${this.#key}:`).toString("base64")}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new TeamworkError(`Cannot reach ${url.host}: ${(err as Error).message}`);
    }

    const raw = await res.text();
    if (!res.ok) throw new TeamworkError(describeError(res.status, raw), res.status);
    return (raw ? JSON.parse(raw) : {}) as T;
  }
}

function normalizePath(path: string): string {
  let p = path.trim();
  if (!p.startsWith("/")) p = `/${p}`;
  // Allow callers to pass the full "/projects/api/v3/..." prefix or a short "/tasks.json" path.
  if (p.startsWith(`${BASE_PATH}/`) || p === BASE_PATH) return p;
  return `${BASE_PATH}${p}`;
}

function describeError(status: number, raw: string): string {
  let detail = raw.slice(0, 400);
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string; code?: string } | string;
      message?: string;
    };
    if (typeof parsed.error === "string") detail = parsed.error;
    else if (parsed.error?.message) detail = parsed.error.message;
    else if (parsed.message) detail = parsed.message;
  } catch {
    // keep raw text
  }

  if (status === 401) {
    return `Teamwork API 401 Unauthorized: invalid or revoked API key. Check the key (Profile > Edit My Details > API & Mobile > Show your Token). ${detail}`;
  }
  if (status === 403) {
    return `Teamwork API 403 Forbidden: this user/key lacks permission for that action. ${detail}`;
  }
  if (status === 429) {
    return `Teamwork API 429 Too Many Requests: rate limit hit, retry later. ${detail}`;
  }
  return `Teamwork API ${status}: ${detail}`;
}
