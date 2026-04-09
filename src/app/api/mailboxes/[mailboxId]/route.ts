import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/tpmail/errors";
import { getMailboxOrThrow, toPublicMailbox } from "@/server/tpmail/service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ mailboxId: string }> }
) {
  try {
    const { mailboxId } = await context.params;
    const mailbox = getMailboxOrThrow(mailboxId);
    return NextResponse.json({ mailbox: toPublicMailbox(mailbox) });
  } catch (error) {
    const result = toErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
