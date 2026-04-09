import { NextResponse } from "next/server";

import { listProvidersWithCacheInfo } from "@/server/tpmail/service";

export async function GET() {
  const { providers, cacheStatus } = listProvidersWithCacheInfo();

  return NextResponse.json(
    { providers },
    {
      headers: {
        "x-tpmail-cache": cacheStatus,
      },
    }
  );
}
