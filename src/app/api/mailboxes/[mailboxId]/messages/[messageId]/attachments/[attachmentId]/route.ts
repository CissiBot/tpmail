import { NextResponse } from "next/server";

import { readMailboxSnapshotFromRequest } from "@/lib/tpmail/mailbox-snapshot";
import { toErrorResponse } from "@/lib/tpmail/errors";
import { getAttachmentRedirect } from "@/server/tpmail/service";

export async function GET(
  request: Request,
  context: {
    params: Promise<{
      mailboxId: string;
      messageId: string;
      attachmentId: string;
    }>;
  }
) {
  try {
    const { mailboxId, messageId, attachmentId } = await context.params;
    const target = await getAttachmentRedirect(
      mailboxId,
      messageId,
      attachmentId,
      readMailboxSnapshotFromRequest(request)
    );

    if (request.headers.get("x-tpmail-download-mode") === "json") {
      return NextResponse.json({ url: target });
    }

    return NextResponse.redirect(target);
  } catch (error) {
    const result = toErrorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
