import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/tpmail/errors";
import { listProviderDomainsWithCacheInfo } from "@/server/tpmail/service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ providerId: string }> }
) {
  try {
    const { providerId } = await context.params;
    const { domains, cacheStatus } = await listProviderDomainsWithCacheInfo(providerId as never);
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
