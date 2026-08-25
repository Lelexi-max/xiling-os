import type { ApiErrorBody } from "@xiling/api-contracts";

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: unknown, message: string) { super(message); }
}

export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => undefined) as T | ApiErrorBody | undefined;
  if (!response.ok) {
    const detail = body && typeof body === "object" && "error" in body ? JSON.stringify((body as ApiErrorBody).error) : response.statusText;
    throw new ApiError(response.status, body, `HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return body as T;
}

export const jsonInit = (method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown, signal?: AbortSignal): RequestInit => ({
  method,
  ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  ...(signal ? { signal } : {}),
});
