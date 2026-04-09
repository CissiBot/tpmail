import { randomUUID } from "node:crypto";

import { providerError } from "@/lib/tpmail/errors";
import {
  AttachmentSummary,
  CreateMailboxInput,
  MailboxSession,
  MessageSummary,
  ProviderContext,
  ProviderDescriptor,
  ProviderDomainOption,
} from "@/lib/tpmail/types";
import { parseAddress, randomLocalPart } from "@/lib/tpmail/utils";
import { requestJson } from "@/server/tpmail/http";
import { ProviderAdapter } from "@/server/tpmail/providers/base";

interface CatchmailMailboxResponse {
  address: string;
  messages: Array<{
    id: string;
    from?: string;
    subject?: string;
    date?: string;
  }>;
}

interface CatchmailMessageResponse {
  id: string;
  mailbox: string;
  from?: string;
  to?: string[];
  subject?: string;
  date?: string;
  body?: {
    text?: string;
    html?: string;
  };
  attachments?: Array<{
    id: string;
    filename?: string;
    content_type?: string;
    size?: number;
    download_url?: string;
  }>;
}

const descriptor: ProviderDescriptor = {
  id: "catchmail",
  name: "Catchmail",
  description: "匿名可用，最适合首版聚合底座。",
  tier: "L1",
  enabled: true,
  productionReady: true,
  accessMode: "public_address",
  requiresSecret: false,
  docsUrl: "https://catchmail.io/docs",
  defaultDomain: "catchmail.io",
  capabilities: {
    createMailbox: true,
    listMessages: true,
    getMessage: true,
    getAttachments: true,
    listDomains: false,
    customDomain: true,
  },
  limitations: ["匿名接口按邮箱地址访问", "匿名访问限流 1 req/s/IP"],
};

function toMailbox(address: string): MailboxSession {
  return {
    id: randomUUID(),
    provider: descriptor.id,
    providerLabel: descriptor.name,
    address: parseAddress(address),
    accessMode: descriptor.accessMode,
    capabilities: descriptor.capabilities,
    createdAt: new Date().toISOString(),
    expiresAt: null,
  };
}

function toSummary(mailboxId: string, item: CatchmailMailboxResponse["messages"][number]): MessageSummary {
  return {
    id: item.id,
    provider: descriptor.id,
    mailboxId,
    from: item.from ?? "未知发件人",
    subject: item.subject ?? "无主题",
    receivedAt: item.date ?? null,
    hasAttachments: false,
  };
}

function toAttachments(items: CatchmailMessageResponse["attachments"]): AttachmentSummary[] {
  return (items ?? []).map((attachment) => ({
    id: attachment.id,
    filename: attachment.filename ?? "未命名附件",
    contentType: attachment.content_type,
    size: attachment.size,
    downloadMode: attachment.download_url ? "redirect" : "unsupported",
  }));
}

export const catchmailAdapter: ProviderAdapter = {
  descriptor,
  async listDomains() {
    const option: ProviderDomainOption = {
      provider: descriptor.id,
      domain: descriptor.defaultDomain ?? "catchmail.io",
      label: descriptor.defaultDomain ?? "catchmail.io",
      isDefault: true,
    };

    return [option];
  },
  async createMailbox(input: CreateMailboxInput) {
    const localPart = input.alias?.trim() || randomLocalPart();
    const domain = input.domain?.trim() || descriptor.defaultDomain;

    if (!domain) {
      throw providerError("INVALID_REQUEST", "Catchmail 缺少可用域名。", 400, descriptor.id);
    }

    const address = `${localPart}@${domain}`;
    return toMailbox(address);
  },
  async listMessages(context: ProviderContext) {
    const url = new URL("/api/v1/mailbox", "https://api.catchmail.io");
    url.searchParams.set("address", context.mailbox.address.address);

    const result = await requestJson<CatchmailMailboxResponse>(url.toString(), undefined, {
      provider: descriptor.id,
    });

    return result.messages.map((item) => toSummary(context.mailbox.id, item));
  },
  async getMessage(context: ProviderContext, messageId: string) {
    if (!messageId) {
      throw providerError("MESSAGE_NOT_FOUND", "缺少邮件 ID。", 404, descriptor.id);
    }

    const url = new URL(`/api/v1/message/${messageId}`, "https://api.catchmail.io");
    url.searchParams.set("mailbox", context.mailbox.address.address);

    const result = await requestJson<CatchmailMessageResponse>(url.toString(), undefined, {
      provider: descriptor.id,
    });

    return {
      id: result.id,
      provider: descriptor.id,
      mailboxId: context.mailbox.id,
      from: result.from ?? "未知发件人",
      to: result.to?.join(", "),
      subject: result.subject ?? "无主题",
      receivedAt: result.date ?? null,
      hasAttachments: (result.attachments?.length ?? 0) > 0,
      html: result.body?.html ?? null,
      text: result.body?.text ?? null,
      attachments: toAttachments(result.attachments),
    };
  },
  async getAttachmentUrl(context: ProviderContext, _messageId: string, attachmentId: string) {
    const detail = await this.getMessage(context, _messageId);
    const target = detail.attachments.find((item) => item.id === attachmentId);

    if (!target) {
      throw providerError("ATTACHMENT_UNAVAILABLE", "附件不存在。", 404, descriptor.id);
    }

    return `https://api.catchmail.io/api/v1/attachment/${attachmentId}?mailbox=${encodeURIComponent(
      context.mailbox.address.address
    )}`;
  },
};
