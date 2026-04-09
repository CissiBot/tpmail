import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/tpmail/errors";
import { createMailbox, toPublicMailbox } from "@/server/tpmail/service";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      provider?: string;
      alias?: string;
      domain?: string;
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
    });

    return NextResponse.json({ mailbox: toPublicMailbox(mailbox) }, { status: 201 });
  } catch (error) {
    const result = toErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
