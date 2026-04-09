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
  id: "duckmail",
  name: "DuckMail",
  description: "公共域名可直连接入，支持更完整的消息模型。",
  tier: "L2",
  enabled: true,
  productionReady: true,
  accessMode: "account_token",
  requiresSecret: false,
  docsUrl: "https://github.com/MoonWeSif/DuckMail",
  capabilities: {
    createMailbox: true,
    listMessages: true,
    getMessage: true,
    getAttachments: true,
    listDomains: true,
    customDomain: true,
  },
  limitations: ["公共域名可用，私有域名仍需 API key", "每次创建会自动生成独立密码并换取 token"],
};

type DuckMailDomainResponse = {
  "hydra:member"?: Array<{
    id: string;
    domain: string;
    isVerified?: boolean;
  }>;
};

type DuckMailAccountResponse = {
  id: string;
  address: string;
  createdAt?: string;
  updatedAt?: string;
};

type DuckMailTokenResponse = {
  id: string;
  token: string;
};

type DuckMailListResponse = {
  "hydra:member"?: Array<{
    id: string;
    from?: {
      name?: string;
      address?: string;
    };
    subject?: string;
    seen?: boolean;
    hasAttachments?: boolean;
    createdAt?: string;
  }>;
};

type DuckMailMessageResponse = {
  id: string;
  from?: {
    name?: string;
    address?: string;
  };
  to?: Array<{
    name?: string;
    address?: string;
  }>;
  subject?: string;
  text?: string;
  html?: string;
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

function toAbsoluteDownloadUrl(downloadUrl?: string) {
  if (!downloadUrl) {
    return undefined;
  }

  if (downloadUrl.startsWith("http://") || downloadUrl.startsWith("https://")) {
    return downloadUrl;
  }

  return new URL(downloadUrl, "https://api.duckmail.sbs").toString();
}

function formatSender(sender?: { name?: string; address?: string }) {
  if (!sender?.address) {
    return sender?.name ?? "未知发件人";
  }

  return sender.name ? `${sender.name} <${sender.address}>` : sender.address;
}

function formatRecipients(recipients?: Array<{ name?: string; address?: string }>) {
  return recipients
    ?.map((recipient) => (recipient.name && recipient.address ? `${recipient.name} <${recipient.address}>` : recipient.address ?? recipient.name ?? ""))
    .filter(Boolean)
    .join(", ");
}

function mapAttachments(items?: DuckMailMessageResponse["attachments"]): AttachmentSummary[] {
  return (items ?? []).map((attachment) => ({
    id: attachment.id,
    filename: attachment.filename ?? "未命名附件",
    contentType: attachment.contentType,
    size: attachment.size,
    downloadMode: attachment.downloadUrl ? "redirect" : "unsupported",
  }));
}

export const duckmailAdapter: ProviderAdapter = {
  descriptor,
  async listDomains() {
    const result = await requestJson<DuckMailDomainResponse>("https://api.duckmail.sbs/domains?page=1", undefined, {
      provider: descriptor.id,
    });

    return (result["hydra:member"] ?? []).map<ProviderDomainOption>((domain, index) => ({
      provider: descriptor.id,
      domain: domain.domain,
      label: domain.domain,
      isDefault: index === 0,
    }));
  },
  async createMailbox(input: CreateMailboxInput) {
    const domains = await this.listDomains?.();
    const domain = input.domain?.trim() || domains?.find((item) => item.isDefault)?.domain || domains?.[0]?.domain;

    if (!domain) {
      throw providerError("PROVIDER_UNREACHABLE", "DuckMail 当前没有可用域名。", 502, descriptor.id, true);
    }

    const localPart = input.alias?.trim() || randomLocalPart();
    const address = `${localPart}@${domain}`;
    const password = randomBytes(12).toString("base64url");

    const account = await requestJson<DuckMailAccountResponse>("https://api.duckmail.sbs/accounts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address,
        password,
        expiresIn: 86400,
      }),
    }, {
      provider: descriptor.id,
      expectedStatus: [200, 201],
    });

    const token = await requestJson<DuckMailTokenResponse>("https://api.duckmail.sbs/token", {
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
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      metadata: {
        token: token.token,
        accountId: token.id,
      },
    } satisfies MailboxSession;
  },
  async listMessages(context: ProviderContext) {
    const token = context.mailbox.metadata?.token;
    if (!token) {
      throw providerError("MAILBOX_ACCESS_DENIED", "DuckMail 会话缺少访问 token。", 400, descriptor.id);
    }

    const result = await requestJson<DuckMailListResponse>("https://api.duckmail.sbs/messages?page=1", {
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
      from: formatSender(message.from),
      subject: message.subject ?? "无主题",
      receivedAt: message.createdAt ?? null,
      hasAttachments: Boolean(message.hasAttachments),
      snippet: message.seen ? "已读邮件" : "新邮件",
    }));
  },
  async getMessage(context: ProviderContext, messageId: string) {
    const token = context.mailbox.metadata?.token;
    if (!token) {
      throw providerError("MAILBOX_ACCESS_DENIED", "DuckMail 会话缺少访问 token。", 400, descriptor.id);
    }

    const result = await requestJson<DuckMailMessageResponse>(`https://api.duckmail.sbs/messages/${messageId}`, {
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
      from: formatSender(result.from),
      to: formatRecipients(result.to),
      subject: result.subject ?? "无主题",
      receivedAt: result.createdAt ?? null,
      hasAttachments: Boolean(result.hasAttachments),
      html: result.html ?? null,
      text: result.text ?? null,
      attachments: mapAttachments(result.attachments),
    } satisfies MessageDetail;
  },
  async getAttachmentUrl(context: ProviderContext, messageId: string, attachmentId: string) {
    const detail = await this.getMessage(context, messageId);
    const attachment = detail.attachments.find((item) => item.id === attachmentId);

    if (!attachment) {
      throw providerError("ATTACHMENT_UNAVAILABLE", "DuckMail 附件不存在。", 404, descriptor.id);
    }

    const token = context.mailbox.metadata?.token;
    const full = await requestJson<DuckMailMessageResponse>(`https://api.duckmail.sbs/messages/${messageId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }, {
      provider: descriptor.id,
    });

    const rawAttachment = full.attachments?.find((item) => item.id === attachmentId);
    const downloadUrl = toAbsoluteDownloadUrl(rawAttachment?.downloadUrl);

    if (!downloadUrl) {
      throw providerError("ATTACHMENT_UNAVAILABLE", "DuckMail 附件下载地址不可用。", 404, descriptor.id);
    }

    return downloadUrl;
  },
};
