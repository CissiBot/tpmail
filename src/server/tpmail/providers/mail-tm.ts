import { randomBytes, randomUUID } from "node:crypto";

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

const descriptor: ProviderDescriptor = {
  id: "mail_tm",
  name: "Mail.tm",
  description: "公开 API、无需 API key，适合补充匿名可接源。",
  tier: "L1",
  enabled: true,
  productionReady: true,
  accessMode: "account_token",
  requiresSecret: false,
  docsUrl: "https://docs.mail.tm/",
  capabilities: {
    createMailbox: true,
    listMessages: true,
    getMessage: true,
    getAttachments: true,
    listDomains: true,
    customDomain: false,
  },
  limitations: ["无需 API key，但每个邮箱都要先创建账号再换 token", "官方限制约 8 QPS / IP"],
};

type MailTmDomain = {
  id: string;
  domain: string;
  isActive?: boolean;
  isPrivate?: boolean;
};

type MailTmDomainListResponse = {
  "hydra:member"?: Array<{
    id: string;
    domain: string;
    isActive?: boolean;
    isPrivate?: boolean;
  }>;
} | MailTmDomain[];

type MailTmAccountResponse = {
  id: string;
  address: string;
  createdAt?: string;
};

type MailTmTokenResponse = {
  id: string;
  token: string;
};

type MailTmAddress = {
  name?: string;
  address?: string;
};

type MailTmMessageListResponse = {
  "hydra:member"?: Array<{
    id: string;
    from?: MailTmAddress;
    to?: MailTmAddress[];
    subject?: string;
    intro?: string;
    hasAttachments?: boolean;
    createdAt?: string;
  }>;
};

type MailTmMessageResponse = {
  id: string;
  from?: MailTmAddress;
  to?: MailTmAddress[];
  subject?: string;
  text?: string;
  html?: string[];
  hasAttachments?: boolean;
  attachments?: Array<{
    id: string;
    filename?: string;
    contentType?: string;
    size?: number;
    downloadUrl?: string;
  }>;
  createdAt?: string;
};

function formatContact(contact?: MailTmAddress) {
  if (!contact?.address) {
    return contact?.name ?? "未知发件人";
  }

  return contact.name ? `${contact.name} <${contact.address}>` : contact.address;
}

function formatRecipients(items?: MailTmAddress[]) {
  return items
    ?.map((item) => (item.name && item.address ? `${item.name} <${item.address}>` : item.address ?? item.name ?? ""))
    .filter(Boolean)
    .join(", ");
}

function toAbsoluteDownloadUrl(downloadUrl?: string) {
  if (!downloadUrl) {
    return undefined;
  }

  if (downloadUrl.startsWith("http://") || downloadUrl.startsWith("https://")) {
    return downloadUrl;
  }

  return new URL(downloadUrl, "https://api.mail.tm").toString();
}

function toAttachments(items?: MailTmMessageResponse["attachments"]): AttachmentSummary[] {
  return (items ?? []).map((attachment) => ({
    id: attachment.id,
    filename: attachment.filename ?? "未命名附件",
    contentType: attachment.contentType,
    size: attachment.size,
    downloadMode: attachment.downloadUrl ? "redirect" : "unsupported",
  }));
}

function toDomainItems(result: MailTmDomainListResponse) {
  if (Array.isArray(result)) {
    return result;
  }

  return result["hydra:member"] ?? [];
}

export const mailTmAdapter: ProviderAdapter = {
  descriptor,
  async listDomains() {
    const result = await requestJson<MailTmDomainListResponse>("https://api.mail.tm/domains", undefined, {
      provider: descriptor.id,
    });

    const domains = toDomainItems(result).filter((item) => item.domain && item.isActive !== false && item.isPrivate !== true);

    return domains.map<ProviderDomainOption>((item, index) => ({
      provider: descriptor.id,
      domain: item.domain,
      label: item.domain,
      isDefault: index === 0,
    }));
  },
  async createMailbox(input: CreateMailboxInput) {
    const domains = await this.listDomains?.();
    const domain = input.domain?.trim() || domains?.find((item) => item.isDefault)?.domain || domains?.[0]?.domain;

    if (!domain) {
      throw providerError("PROVIDER_UNREACHABLE", "Mail.tm 当前没有可用域名。", 502, descriptor.id, true);
    }

    const localPart = input.alias?.trim() || randomLocalPart();
    const address = `${localPart}@${domain}`;
    const password = randomBytes(12).toString("base64url");

    const account = await requestJson<MailTmAccountResponse>("https://api.mail.tm/accounts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address,
        password,
      }),
    }, {
      provider: descriptor.id,
      expectedStatus: [200, 201],
    });

    const token = await requestJson<MailTmTokenResponse>("https://api.mail.tm/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address,
        password,
      }),
    }, {
      provider: descriptor.id,
      expectedStatus: [200, 201],
    });

    return {
      id: randomUUID(),
      provider: descriptor.id,
      providerLabel: descriptor.name,
      address: parseAddress(account.address),
      accessMode: descriptor.accessMode,
      capabilities: descriptor.capabilities,
      createdAt: account.createdAt ?? new Date().toISOString(),
      expiresAt: null,
      metadata: {
        token: token.token,
        accountId: account.id,
      },
    } satisfies MailboxSession;
  },
  async listMessages(context: ProviderContext) {
    const token = context.mailbox.metadata?.token;
    if (!token) {
      throw providerError("MAILBOX_ACCESS_DENIED", "Mail.tm 会话缺少访问 token。", 400, descriptor.id);
    }

    const result = await requestJson<MailTmMessageListResponse>("https://api.mail.tm/messages", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }, {
      provider: descriptor.id,
    });

    return (result["hydra:member"] ?? []).map<MessageSummary>((message) => ({
      id: message.id,
      provider: descriptor.id,
      mailboxId: context.mailbox.id,
      from: formatContact(message.from),
      to: formatRecipients(message.to),
      subject: message.subject ?? "无主题",
      receivedAt: message.createdAt ?? null,
      hasAttachments: Boolean(message.hasAttachments),
      snippet: message.intro ?? undefined,
    }));
  },
  async getMessage(context: ProviderContext, messageId: string) {
    const token = context.mailbox.metadata?.token;
    if (!token) {
      throw providerError("MAILBOX_ACCESS_DENIED", "Mail.tm 会话缺少访问 token。", 400, descriptor.id);
    }

    const result = await requestJson<MailTmMessageResponse>(`https://api.mail.tm/messages/${messageId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }, {
      provider: descriptor.id,
    });

    return {
      id: result.id,
      provider: descriptor.id,
      mailboxId: context.mailbox.id,
      from: formatContact(result.from),
      to: formatRecipients(result.to),
      subject: result.subject ?? "无主题",
      receivedAt: result.createdAt ?? null,
      hasAttachments: Boolean(result.hasAttachments),
      html: result.html?.find((item) => item.trim().length > 0) ?? null,
      text: result.text ?? null,
      attachments: toAttachments(result.attachments),
    } satisfies MessageDetail;
  },
  async getAttachmentUrl(context: ProviderContext, messageId: string, attachmentId: string) {
    const detail = await this.getMessage(context, messageId);
    const attachment = detail.attachments.find((item) => item.id === attachmentId);

    if (!attachment) {
      throw providerError("ATTACHMENT_UNAVAILABLE", "Mail.tm 附件不存在。", 404, descriptor.id);
    }

    const token = context.mailbox.metadata?.token;
    const full = await requestJson<MailTmMessageResponse>(`https://api.mail.tm/messages/${messageId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }, {
      provider: descriptor.id,
    });

    const rawAttachment = full.attachments?.find((item) => item.id === attachmentId);
    const downloadUrl = toAbsoluteDownloadUrl(rawAttachment?.downloadUrl);

    if (!downloadUrl) {
      throw providerError("ATTACHMENT_UNAVAILABLE", "Mail.tm 附件下载地址不可用。", 404, descriptor.id);
    }

    return downloadUrl;
  },
};
