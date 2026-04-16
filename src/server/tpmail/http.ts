import { AppError, providerError } from "@/lib/tpmail/errors";
import { ProviderId } from "@/lib/tpmail/types";

const DEFAULT_TIMEOUT_MS = 12000;

function shouldTreatAsJson(response: Response, text: string) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json") || contentType.includes("+json")) {
    return true;
  }

  const trimmed = text.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function parseJsonBody<T>(response: Response, text: string, provider?: ProviderId): T {
  if (!shouldTreatAsJson(response, text)) {
    throw providerError(
      "PROVIDER_RESPONSE_INVALID",
      "上游 provider 返回了无法识别的响应格式。",
      502,
      provider,
      true,
      text.trim()
        ? {
            contentType: response.headers.get("content-type") ?? undefined,
            body: text,
          }
        : {
            contentType: response.headers.get("content-type") ?? undefined,
          }
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw providerError(
      "PROVIDER_RESPONSE_INVALID",
      "上游 provider 返回了无效的 JSON 响应。",
      502,
      provider,
      true,
      {
        contentType: response.headers.get("content-type") ?? undefined,
        body: text,
      }
    );
  }
}

function tryParseJsonBody(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

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
      const rawBody = await response.text();
      const details = shouldTreatAsJson(response, rawBody) ? (tryParseJsonBody(rawBody) ?? rawBody) : rawBody;

      throw providerError(
        response.status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_REQUEST_FAILED",
        `上游 provider 请求失败（${response.status}）。`,
        response.status,
        options?.provider,
        response.status >= 500 || response.status === 429,
        { details }
      );
    }

    const rawBody = await response.text();
    return parseJsonBody<T>(response, rawBody, options?.provider);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw providerError("PROVIDER_TIMEOUT", "上游 provider 响应超时。", 504, options?.provider, true);
    }

    if (error instanceof AppError) {
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
