import { randomUUID } from "node:crypto";

import { providerError } from "@/lib/tpmail/errors";
import {
  AttachmentSummary,
  CreateMailboxInput,
  MailboxSession,
  MessageDetail,
  MessageSummary,
  ProviderContext,
  ProviderDescriptor,
  ProviderDomainOption,
} from "@/lib/tpmail/types";
import { parseAddress, randomLocalPart } from "@/lib/tpmail/utils";
import { requestJson } from "@/server/tpmail/http";
import { ProviderAdapter } from "@/server/tpmail/providers/base";

const apiKey = process.env.INBOXES_API_KEY?.trim();
const baseUrl = "https://inboxes.com/api/v3";

const descriptor: ProviderDescriptor = {
  id: "inboxes",
  name: "Inboxes.com",
  description: "商业 API，支持激活 inbox、读信与附件下载。",
  tier: "L3",
  enabled: Boolean(apiKey),
  productionReady: Boolean(apiKey),
  accessMode: "api_key",
  requiresSecret: true,
  docsUrl: "https://inboxes.com/api_docs/",
  capabilities: {
    createMailbox: true,
    listMessages: true,
    getMessage: true,
    getAttachments: true,
    listDomains: true,
    customDomain: false,
  },
  limitations: ["需要 Inboxes.com / RapidAPI key", "没有配置 INBOXES_API_KEY 时会自动保持禁用"],
};

type InboxesDomainResponse = Array<{
  qdn: string;
}>;

type InboxesListResponse = Array<{
  uid: string;
  from: string;
  to: string;
  subject: string;
  created_at: string;
  created_at_epoch?: number;
}>;

type InboxesAttachment = {
  id: string;
  filename: string;
  size: number;
  type: string;
};

type InboxesMessageResponse = {
  uid: string;
  from: string;
  to: string;
  subject: string;
  attachments: InboxesAttachment[];
  created_at: string;
  created_at_epoch?: number;
  html: string;
  text: string;
};

type InboxesAttachmentDownloadResponse = {
  download_url?: string;
};

function requireApiKey() {
  if (!apiKey) {
    throw providerError("PROVIDER_DISABLED", "Inboxes.com 需要后端托管 API key，当前未启用。", 503, descriptor.id);
  }

  return apiKey;
}

function authHeaders() {
  return {
    apikey: requireApiKey(),
  };
}

function toSnippet(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 160) || undefined;
}

function mailboxOwnsMessage(mailboxAddress: string, target?: string) {
  if (!target) {
    return false;
  }

  return target
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .some((item) => item.includes(mailboxAddress.toLowerCase()));
}

function toAttachments(items: InboxesAttachment[]): AttachmentSummary[] {
  return (items ?? []).map((attachment) => ({
    id: attachment.id,
    filename: attachment.filename,
    contentType: attachment.type,
    size: attachment.size,
    downloadMode: "redirect",
  }));
}

export const inboxesAdapter: ProviderAdapter = {
  descriptor,
  async listDomains() {
    const result = await requestJson<InboxesDomainResponse>(`${baseUrl}/domains`, {
      headers: authHeaders(),
    }, {
      provider: descriptor.id,
    });

    return result.map<ProviderDomainOption>((item, index) => ({
      provider: descriptor.id,
      domain: item.qdn,
      label: item.qdn,
      isDefault: index === 0,
    }));
  },
  async createMailbox(input: CreateMailboxInput) {
    const domains = await this.listDomains?.();
    const domain = input.domain?.trim() || domains?.find((item) => item.isDefault)?.domain || domains?.[0]?.domain;

    if (!domain) {
      throw providerError("PROVIDER_UNREACHABLE", "Inboxes.com 当前没有可用域名。", 502, descriptor.id, true);
    }

    const localPart = input.alias?.trim() || randomLocalPart();
    const address = `${localPart}@${domain}`;

    await requestJson<{ ok: boolean }>(`${baseUrl}/inboxes/${encodeURIComponent(address)}`, {
      method: "POST",
      headers: authHeaders(),
    }, {
      provider: descriptor.id,
      expectedStatus: [200, 201],
    });

    return {
      id: randomUUID(),
      provider: descriptor.id,
      providerLabel: descriptor.name,
      address: parseAddress(address),
      accessMode: descriptor.accessMode,
      capabilities: descriptor.capabilities,
      createdAt: new Date().toISOString(),
      expiresAt: null,
    } satisfies MailboxSession;
  },
  async listMessages(context: ProviderContext) {
    const result = await requestJson<InboxesListResponse>(
      `${baseUrl}/inboxes/${encodeURIComponent(context.mailbox.address.address)}`,
      {
        headers: authHeaders(),
      },
      {
        provider: descriptor.id,
      }
    );

    return result.map<MessageSummary>((message) => ({
      id: message.uid,
      provider: descriptor.id,
      mailboxId: context.mailbox.id,
      from: message.from || "未知发件人",
      to: message.to || undefined,
      subject: message.subject || "无主题",
      receivedAt: message.created_at || null,
      hasAttachments: false,
    }));
  },
  async getMessage(context: ProviderContext, messageId: string) {
    const result = await requestJson<InboxesMessageResponse>(`${baseUrl}/messages/${encodeURIComponent(messageId)}`, {
      headers: authHeaders(),
    }, {
      provider: descriptor.id,
    });

    if (!mailboxOwnsMessage(context.mailbox.address.address, result.to)) {
      throw providerError("MESSAGE_NOT_FOUND", "目标邮件不属于当前邮箱会话。", 404, descriptor.id);
    }

    return {
      id: result.uid,
      provider: descriptor.id,
      mailboxId: context.mailbox.id,
      from: result.from || "未知发件人",
      to: result.to || undefined,
      subject: result.subject || "无主题",
      receivedAt: result.created_at || null,
      hasAttachments: (result.attachments?.length ?? 0) > 0,
      snippet: toSnippet(result.text || result.html || ""),
      html: result.html || null,
      text: result.text || null,
      attachments: toAttachments(result.attachments ?? []),
    } satisfies MessageDetail;
  },
  async getAttachmentUrl(_context: ProviderContext, messageId: string, attachmentId: string) {
    const detail = await this.getMessage(_context, messageId);
    const attachment = detail.attachments.find((item) => item.id === attachmentId);

    if (!attachment) {
      throw providerError("ATTACHMENT_UNAVAILABLE", "Inboxes.com 附件不存在。", 404, descriptor.id);
    }

    const result = await requestJson<InboxesAttachmentDownloadResponse>(
      `${baseUrl}/attachments/${encodeURIComponent(messageId)}/${encodeURIComponent(attachmentId)}`,
      {
        headers: authHeaders(),
      },
      {
        provider: descriptor.id,
      }
    );

    if (!result.download_url) {
      throw providerError("ATTACHMENT_UNAVAILABLE", "Inboxes.com 附件下载地址不可用。", 404, descriptor.id);
    }

    return result.download_url;
  },
};
