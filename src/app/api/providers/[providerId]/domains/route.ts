import { NextResponse } from "next/server";

import { readApiKeyFromRequest } from "@/lib/tpmail/provider-credentials";
import { toErrorResponse } from "@/lib/tpmail/errors";
import { listProviderDomainsWithCacheInfo } from "@/server/tpmail/service";

export async function GET(
  request: Request,
  context: { params: Promise<{ providerId: string }> }
) {
  try {
    const { providerId } = await context.params;
    const { domains, cacheStatus } = await listProviderDomainsWithCacheInfo(providerId as never, {
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
