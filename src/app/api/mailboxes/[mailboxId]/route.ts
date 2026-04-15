import { NextResponse } from "next/server";

import { readMailboxSnapshotFromRequest } from "@/lib/tpmail/mailbox-snapshot";
import { toErrorResponse } from "@/lib/tpmail/errors";
import { getMailboxOrThrow, toPublicMailbox } from "@/server/tpmail/service";

export async function GET(
  request: Request,
  context: { params: Promise<{ mailboxId: string }> }
) {
  try {
    const { mailboxId } = await context.params;
    const mailbox = getMailboxOrThrow(mailboxId, readMailboxSnapshotFromRequest(request));
    return NextResponse.json({ mailbox: toPublicMailbox(mailbox) });
  } catch (error) {
    const result = toErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
