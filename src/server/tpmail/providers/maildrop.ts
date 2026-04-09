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
    inbox?: {
      messages?: Array<{
        id: string;
        headerfrom?: string;
        subject?: string;
        receivedAt?: string;
        text?: string;
      }>;
    };
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
      subject?: string;
      receivedAt?: string;
      html?: string;
      text?: string;
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
    const domain = input.domain?.trim() || descriptor.defaultDomain;

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
          messages {
            id
            headerfrom
            subject
            receivedAt
            text
          }
        }
      }`,
      { mailbox: localPart }
    );

    if (result.errors?.length) {
      throw providerError(
        "PROVIDER_REQUEST_FAILED",
        result.errors[0]?.message ?? "Maildrop 返回了 GraphQL 错误。",
        502,
        descriptor.id,
        false,
        { errors: result.errors }
      );
    }

    return (result.data?.inbox?.messages ?? []).map<MessageSummary>((item) => ({
      id: item.id,
      provider: descriptor.id,
      mailboxId: context.mailbox.id,
      from: item.headerfrom ?? "未知发件人",
      subject: item.subject ?? "无主题",
      receivedAt: item.receivedAt ?? null,
      hasAttachments: false,
      snippet: htmlToSnippet(item.text),
    }));
  },
  async getMessage(context: ProviderContext, messageId: string) {
    const localPart = context.mailbox.address.localPart;
    const result = await graphql<MaildropDetailResponse>(
      `query Message($mailbox: String!, $id: ID!) {
        message(mailbox: $mailbox, id: $id) {
          id
          headerfrom
          subject
          receivedAt
          html
          text
        }
      }`,
      { mailbox: localPart, id: messageId }
    );

    if (result.errors?.length) {
      throw providerError(
        "PROVIDER_REQUEST_FAILED",
        result.errors[0]?.message ?? "Maildrop 返回了 GraphQL 错误。",
        502,
        descriptor.id,
        false,
        { errors: result.errors }
      );
    }

    const message = result.data?.message;
    if (!message) {
      throw providerError("MESSAGE_NOT_FOUND", "目标邮件不存在或已被 Maildrop 清理。", 404, descriptor.id);
    }

    return {
      id: message.id,
      provider: descriptor.id,
      mailboxId: context.mailbox.id,
      from: message.headerfrom ?? "未知发件人",
      subject: message.subject ?? "无主题",
      receivedAt: message.receivedAt ?? null,
      hasAttachments: false,
      html: message.html ?? null,
      text: message.text ?? null,
      attachments: [],
    };
  },
};
