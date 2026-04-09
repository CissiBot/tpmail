import { ProviderApiErrorShape, ProviderId } from "@/lib/tpmail/types";

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly provider?: ProviderId;
  readonly details?: Record<string, unknown>;

  constructor({
    code,
    message,
    status,
    retryable,
    provider,
    details,
  }: ProviderApiErrorShape) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.provider = provider;
    this.details = details;
  }
}

export function toErrorResponse(error: unknown) {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          status: error.status,
          retryable: error.retryable,
          provider: error.provider,
          details: error.details,
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "服务暂时不可用，请稍后重试。",
        status: 500,
        retryable: true,
      },
    },
  };
}

export function providerError(
  code: string,
  message: string,
  status: number,
  provider?: ProviderId,
  retryable = false,
  details?: Record<string, unknown>
) {
  return new AppError({
    code,
    message,
    status,
    provider,
    retryable,
    details,
  });
}
