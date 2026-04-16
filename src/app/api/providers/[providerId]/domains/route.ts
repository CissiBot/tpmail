import { NextResponse } from "next/server";

import { providerError, toErrorResponse } from "@/lib/tpmail/errors";
import { readApiKeyFromRequest } from "@/lib/tpmail/provider-credentials";
import { isProviderId } from "@/lib/tpmail/types";
import { listProviderDomainsWithCacheInfo } from "@/server/tpmail/service";

export async function GET(
  request: Request,
  context: { params: Promise<{ providerId: string }> }
) {
  try {
    const { providerId } = await context.params;
    if (!isProviderId(providerId)) {
      throw providerError("INVALID_REQUEST", "未知 provider。", 400);
    }

    const { domains, cacheStatus } = await listProviderDomainsWithCacheInfo(providerId, {
      apiKey: readApiKeyFromRequest(request),
    });
    return NextResponse.json(
      { domains },
      {
        headers: {
          "x-tpmail-cache": cacheStatus,
        },
      }
    );
  } catch (error) {
    const result = toErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
