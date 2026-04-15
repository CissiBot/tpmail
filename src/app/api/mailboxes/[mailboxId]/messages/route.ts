import { NextResponse } from "next/server";

import { readMailboxSnapshotFromRequest } from "@/lib/tpmail/mailbox-snapshot";
import { toErrorResponse } from "@/lib/tpmail/errors";
import { listMailboxMessages } from "@/server/tpmail/service";

export async function GET(
  request: Request,
  context: { params: Promise<{ mailboxId: string }> }
) {
  try {
    const { mailboxId } = await context.params;
    const messages = await listMailboxMessages(mailboxId, readMailboxSnapshotFromRequest(request));
    return NextResponse.json({ messages });
  } catch (error) {
    const result = toErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
