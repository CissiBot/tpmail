import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/tpmail/errors";
import { getMailboxMessage } from "@/server/tpmail/service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ mailboxId: string; messageId: string }> }
) {
  try {
    const { mailboxId, messageId } = await context.params;
    const message = await getMailboxMessage(mailboxId, messageId);
    return NextResponse.json({ message });
  } catch (error) {
    const result = toErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
