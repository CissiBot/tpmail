import { NextResponse } from "next/server";

import { normalizeApiKey } from "@/lib/tpmail/provider-credentials";
import { providerError, toErrorResponse } from "@/lib/tpmail/errors";
import { isProviderId } from "@/lib/tpmail/types";
import { createMailbox, toClientMailbox } from "@/server/tpmail/service";

type CreateMailboxRequestBody = {
  provider?: string;
  alias?: string;
  domain?: string;
  apiKey?: string;
};

function readOptionalStringField(value: unknown, fieldLabel: string) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw providerError("INVALID_REQUEST", `${fieldLabel} 必须是字符串。`, 400);
  }

  return value;
}

async function readCreateMailboxBody(request: Request): Promise<CreateMailboxRequestBody> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw providerError("INVALID_REQUEST", "请求体必须是合法 JSON 对象。", 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw providerError("INVALID_REQUEST", "请求体必须是 JSON 对象。", 400);
  }

  return {
    provider: readOptionalStringField(Reflect.get(body, "provider"), "provider"),
    alias: readOptionalStringField(Reflect.get(body, "alias"), "alias"),
    domain: readOptionalStringField(Reflect.get(body, "domain"), "domain"),
    apiKey: readOptionalStringField(Reflect.get(body, "apiKey"), "apiKey"),
  };
}

export async function POST(request: Request) {
  try {
    const body = await readCreateMailboxBody(request);

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

    if (!isProviderId(body.provider)) {
      throw providerError("INVALID_REQUEST", "未知 provider。", 400);
    }

    const mailbox = await createMailbox({
      provider: body.provider,
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
