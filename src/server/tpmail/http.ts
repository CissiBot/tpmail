import { providerError } from "@/lib/tpmail/errors";
import { ProviderId } from "@/lib/tpmail/types";

const DEFAULT_TIMEOUT_MS = 12000;

function withTimeout(init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return {
    init: {
      ...init,
      signal: controller.signal,
    },
    clear: () => clearTimeout(timeout),
  };
}

export async function requestJson<T>(
  input: string,
  init?: RequestInit,
  options?: {
    provider?: ProviderId;
    expectedStatus?: number[];
    timeoutMs?: number;
  }
): Promise<T> {
  const { init: timedInit, clear } = withTimeout(init, options?.timeoutMs);

  try {
    const response = await fetch(input, {
      ...timedInit,
      headers: {
        Accept: "application/json",
        ...(timedInit.headers ?? {}),
      },
      cache: "no-store",
    });

    const expectedStatus = options?.expectedStatus ?? [200];
    if (!expectedStatus.includes(response.status)) {
      let details: unknown;

      try {
        details = await response.json();
      } catch {
        details = await response.text();
      }

      throw providerError(
        response.status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_REQUEST_FAILED",
        `上游 provider 请求失败（${response.status}）。`,
        response.status,
        options?.provider,
        response.status >= 500 || response.status === 429,
        { details }
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw providerError("PROVIDER_TIMEOUT", "上游 provider 响应超时。", 504, options?.provider, true);
    }

    if (error instanceof Error && error.name === "AppError") {
      throw error;
    }

    throw providerError(
      "PROVIDER_UNREACHABLE",
      "上游 provider 当前不可达。",
      502,
      options?.provider,
      true,
      error instanceof Error ? { cause: error.message } : undefined
    );
  } finally {
    clear();
  }
}

export async function requestText(
  input: string,
  init?: RequestInit,
  options?: {
    provider?: ProviderId;
    timeoutMs?: number;
  }
) {
  const { init: timedInit, clear } = withTimeout(init, options?.timeoutMs);

  let response: Response;

  try {
    response = await fetch(input, {
      ...timedInit,
      cache: "no-store",
    });
  } catch (error) {
    clear();

    if (error instanceof Error && error.name === "AbortError") {
      throw providerError("PROVIDER_TIMEOUT", "上游 provider 响应超时。", 504, options?.provider, true);
    }

    throw providerError(
      "PROVIDER_UNREACHABLE",
      "上游 provider 当前不可达。",
      502,
      options?.provider,
      true,
      error instanceof Error ? { cause: error.message } : undefined
    );
  }

  if (!response.ok) {
    clear();
    throw providerError(
      response.status === 404 ? "ATTACHMENT_UNAVAILABLE" : "PROVIDER_REQUEST_FAILED",
      `附件请求失败（${response.status}）。`,
      response.status,
      options?.provider,
      response.status >= 500 || response.status === 429
    );
  }

  clear();
  return response;
}
