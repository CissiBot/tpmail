import { NextResponse } from "next/server";

import { normalizeApiKey } from "@/lib/tpmail/provider-credentials";
import { toErrorResponse } from "@/lib/tpmail/errors";
import { createMailbox, toClientMailbox } from "@/server/tpmail/service";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      provider?: string;
      alias?: string;
      domain?: string;
      apiKey?: string;
    };

    if (!body.provider) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "缺少 provider。",
            status: 400,
            retryable: false,
          },
        },
        { status: 400 }
      );
    }

    const mailbox = await createMailbox({
      provider: body.provider as never,
      alias: body.alias,
      domain: body.domain,
      credentials: {
        apiKey: normalizeApiKey(body.apiKey),
      },
    });

    return NextResponse.json({ mailbox: toClientMailbox(mailbox) }, { status: 201 });
  } catch (error) {
    const result = toErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
