import { randomUUID } from "node:crypto";

import { providerError } from "@/lib/tpmail/errors";
import {
  AttachmentSummary,
  CreateMailboxInput,
  MailboxSession,
  MessageDetail,
  MessageSummary,
  ProviderCredentialInput,
  ProviderContext,
  ProviderDescriptor,
  ProviderDomainOption,
} from "@/lib/tpmail/types";
import { normalizeApiKey } from "@/lib/tpmail/provider-credentials";
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
  enabled: true,
  productionReady: true,
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
  limitations: ["需要 Inboxes.com / RapidAPI key", "可由用户在浏览器输入自己的 API key，或由站长配置 INBOXES_API_KEY"],
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

function requireApiKey(candidate?: string) {
  const resolved = normalizeApiKey(candidate) ?? apiKey;
  if (!resolved) {
    throw providerError(
      "PROVIDER_DISABLED",
      "Inboxes.com 需要 API key。请在当前浏览器输入你自己的 key，或由站长配置 INBOXES_API_KEY。",
      503,
      descriptor.id
    );
  }

  return resolved;
}

function authHeaders(candidate?: string) {
  return {
    apikey: requireApiKey(candidate),
  };
}

function resolveMailboxApiKey(mailbox: ProviderContext["mailbox"]) {
  return requireApiKey(mailbox.metadata?.apiKey);
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
  async listDomains(credentials?: ProviderCredentialInput) {
    const result = await requestJson<InboxesDomainResponse>(`${baseUrl}/domains`, {
      headers: authHeaders(credentials?.apiKey),
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
    const inputApiKey = normalizeApiKey(input.credentials?.apiKey);
    const domains = await this.listDomains?.({ apiKey: inputApiKey });
    const domain = input.domain?.trim() || domains?.find((item) => item.isDefault)?.domain || domains?.[0]?.domain;

    if (!domain) {
      throw providerError("PROVIDER_UNREACHABLE", "Inboxes.com 当前没有可用域名。", 502, descriptor.id, true);
    }

    const localPart = input.alias?.trim() || randomLocalPart();
    const address = `${localPart}@${domain}`;

    await requestJson<{ ok: boolean }>(`${baseUrl}/inboxes/${encodeURIComponent(address)}`, {
      method: "POST",
      headers: authHeaders(inputApiKey),
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
      metadata: inputApiKey
        ? {
            apiKey: inputApiKey,
          }
        : undefined,
    } satisfies MailboxSession;
  },
  async listMessages(context: ProviderContext) {
    const resolvedApiKey = resolveMailboxApiKey(context.mailbox);
    const result = await requestJson<InboxesListResponse>(
      `${baseUrl}/inboxes/${encodeURIComponent(context.mailbox.address.address)}`,
      {
        headers: authHeaders(resolvedApiKey),
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
    const resolvedApiKey = resolveMailboxApiKey(context.mailbox);
    const result = await requestJson<InboxesMessageResponse>(`${baseUrl}/messages/${encodeURIComponent(messageId)}`, {
      headers: authHeaders(resolvedApiKey),
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
    const resolvedApiKey = resolveMailboxApiKey(_context.mailbox);
    const detail = await this.getMessage(_context, messageId);
    const attachment = detail.attachments.find((item) => item.id === attachmentId);

    if (!attachment) {
      throw providerError("ATTACHMENT_UNAVAILABLE", "Inboxes.com 附件不存在。", 404, descriptor.id);
    }

    const result = await requestJson<InboxesAttachmentDownloadResponse>(
      `${baseUrl}/attachments/${encodeURIComponent(messageId)}/${encodeURIComponent(attachmentId)}`,
      {
        headers: authHeaders(resolvedApiKey),
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
