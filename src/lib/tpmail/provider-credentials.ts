export const PROVIDER_API_KEY_HEADER = "x-tpmail-provider-api-key";

export function normalizeApiKey(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function readApiKeyFromRequest(request: Request) {
  return normalizeApiKey(request.headers.get(PROVIDER_API_KEY_HEADER));
}
