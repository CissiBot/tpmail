import { randomUUID } from "node:crypto";

import {
  CreateMailboxInput,
  MailboxSession,
  MessageSummary,
  ProviderContext,
  ProviderDescriptor,
  ProviderDomainOption,
} from "@/lib/tpmail/types";
import { providerError } from "@/lib/tpmail/errors";
import { htmlToSnippet, parseAddress, randomLocalPart } from "@/lib/tpmail/utils";
import { requestJson } from "@/server/tpmail/http";
import { ProviderAdapter } from "@/server/tpmail/providers/base";

interface MaildropListResponse {
  data?: {
    inbox?: Array<{
      id: string;
      headerfrom?: string;
      mailfrom?: string;
      rcptto?: string;
      subject?: string;
      date?: string;
    }>;
  };
  errors?: Array<{
    message?: string;
  }>;
}

interface MaildropDetailResponse {
  data?: {
    message?: {
      id: string;
      headerfrom?: string;
      mailfrom?: string;
      rcptto?: string;
      subject?: string;
      date?: string;
      html?: string;
      data?: string;
    };
  };
  errors?: Array<{
    message?: string;
  }>;
}

const descriptor: ProviderDescriptor = {
  id: "maildrop",
  name: "Maildrop",
  description: "GraphQL 读取型 provider，适合做受限兼容。",
  tier: "L2",
  enabled: true,
  productionReady: true,
  accessMode: "public_address",
  requiresSecret: false,
  docsUrl: "https://docs.maildrop.cc",
  defaultDomain: "maildrop.cc",
  capabilities: {
    createMailbox: true,
    listMessages: true,
    getMessage: true,
    getAttachments: false,
    listDomains: false,
    customDomain: false,
  },
  limitations: ["24 小时无新信会清空", "单邮箱最多 10 封", "首次投递可能被 greylisting 延迟"],
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
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

async function graphql<T>(query: string, variables: Record<string, unknown>) {
  return requestJson<T>("https://api.maildrop.cc/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  }, {
    provider: descriptor.id,
  });
}

function ensureNoGraphqlErrors(errors: Array<{ message?: string }> | undefined, action: string) {
  if (!errors?.length) {
    return;
  }

  throw providerError("PROVIDER_REQUEST_FAILED", `Maildrop ${action}失败。`, 502, descriptor.id, true, {
    errors,
  });
}

export const maildropAdapter: ProviderAdapter = {
  descriptor,
  async listDomains() {
    const option: ProviderDomainOption = {
      provider: descriptor.id,
      domain: descriptor.defaultDomain ?? "maildrop.cc",
      label: descriptor.defaultDomain ?? "maildrop.cc",
      isDefault: true,
    };

    return [option];
  },
  async createMailbox(input: CreateMailboxInput) {
    const localPart = input.alias?.trim() || randomLocalPart();
    const requestedDomain = input.domain?.trim();
    if (requestedDomain && requestedDomain !== descriptor.defaultDomain) {
      throw providerError(
        "INVALID_REQUEST",
        `Maildrop 仅支持 ${descriptor.defaultDomain} 域名。`,
        400,
        descriptor.id
      );
    }

    const domain = requestedDomain || descriptor.defaultDomain;

    if (!domain) {
      throw providerError("INVALID_REQUEST", "Maildrop 缺少可用域名。", 400, descriptor.id);
    }

    const address = `${localPart}@${domain}`;
    return toMailbox(address);
  },
  async listMessages(context: ProviderContext) {
    const localPart = context.mailbox.address.localPart;
    const result = await graphql<MaildropListResponse>(
      `query Inbox($mailbox: String!) {
        inbox(mailbox: $mailbox) {
          id
          headerfrom
          mailfrom
          rcptto
          subject
          date
        }
      }`,
      { mailbox: localPart }
    );

    ensureNoGraphqlErrors(result.errors, "收件箱查询");

    return (result.data?.inbox ?? []).map<MessageSummary>((item) => ({
      id: item.id,
      provider: descriptor.id,
      mailboxId: context.mailbox.id,
      from: item.headerfrom ?? item.mailfrom ?? "未知发件人",
      to: item.rcptto ?? context.mailbox.address.address,
      subject: item.subject ?? "无主题",
      receivedAt: item.date ?? null,
      hasAttachments: false,
      snippet: undefined,
    }));
  },
  async getMessage(context: ProviderContext, messageId: string) {
    const localPart = context.mailbox.address.localPart;
    const result = await graphql<MaildropDetailResponse>(
      `query Message($mailbox: String!, $id: String!) {
        message(mailbox: $mailbox, id: $id) {
          id
          headerfrom
          mailfrom
          rcptto
          subject
          date
          data
          html
        }
      }`,
      { mailbox: localPart, id: messageId }
    );

    ensureNoGraphqlErrors(result.errors, "邮件详情查询");

    const message = result.data?.message;
    if (!message) {
      throw providerError("MESSAGE_NOT_FOUND", "目标邮件不存在或已被 Maildrop 清理。", 404, descriptor.id);
    }

    return {
      id: message.id,
      provider: descriptor.id,
      mailboxId: context.mailbox.id,
      from: message.headerfrom ?? message.mailfrom ?? "未知发件人",
      to: message.rcptto ?? context.mailbox.address.address,
      subject: message.subject ?? "无主题",
      receivedAt: message.date ?? null,
      hasAttachments: false,
      html: message.html ?? null,
      text: message.data ?? (htmlToSnippet(message.html) || null),
      attachments: [],
    };
  },
};
