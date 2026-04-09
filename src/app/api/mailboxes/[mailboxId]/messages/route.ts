import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/tpmail/errors";
import { listMailboxMessages } from "@/server/tpmail/service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ mailboxId: string }> }
) {
  try {
    const { mailboxId } = await context.params;
    const messages = await listMailboxMessages(mailboxId);
    return NextResponse.json({ messages });
  } catch (error) {
    const result = toErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
