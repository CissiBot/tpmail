import { randomUUID } from "node:crypto";

import { AppError, providerError } from "@/lib/tpmail/errors";
import {
  CreateMailboxInput,
  MailboxSession,
  MessageDetail,
  MessageSummary,
  ProviderContext,
  ProviderDescriptor,
} from "@/lib/tpmail/types";
import { parseAddress } from "@/lib/tpmail/utils";
import { requestJson } from "@/server/tpmail/http";
import { ProviderAdapter } from "@/server/tpmail/providers/base";

interface TempmailCreateResponse {
  address?: string;
  email?: string;
  token?: string;
  expiresAt?: string;
  expires_at?: string;
}

interface TempmailListResponse {
  emails?: Array<{
    id?: string;
    from?: string;
    to?: string;
    subject?: string;
    body?: string;
    html?: string;
    date?: string;
  }>; 
}

type TempmailRestrictionPayload = {
  error?: string;
  captcha_required?: boolean;
};

const descriptor: ProviderDescriptor = {
  id: "tempmail_lol",
  name: "TempMail.lol",
  description: "支持 inbox token 的轻量 provider。",
  tier: "L1",
  enabled: true,
  productionReady: true,
  accessMode: "inbox_token",
  requiresSecret: false,
  docsUrl: "https://tempmail.lol/en/api",
  capabilities: {
    createMailbox: true,
    listMessages: true,
    getMessage: true,
    getAttachments: false,
    listDomains: false,
    customDomain: true,
  },
  limitations: ["核心访问依赖 inbox token", "自定义域名与私有 webhook 需要 API key"],
};

function mapMessage(mailboxId: string, message: NonNullable<TempmailListResponse["emails"]>[number]): MessageSummary {
  const id = message.id ?? `${message.date ?? "unknown"}-${message.subject ?? "untitled"}`;

  return {
    id,
    provider: descriptor.id,
    mailboxId,
    from: message.from ?? "未知发件人",
    to: message.to,
    subject: message.subject ?? "无主题",
    receivedAt: message.date ?? null,
    hasAttachments: false,
    snippet: message.body?.slice(0, 160),
  };
}

function toRestrictionPayload(error: AppError): TempmailRestrictionPayload | null {
  const details = error.details?.details;
  if (!details || typeof details !== "object") {
    return null;
  }

  const payload = details as TempmailRestrictionPayload;
  return typeof payload.error === "string" ? payload : null;
}

function isGeoRestriction(payload: TempmailRestrictionPayload | null) {
  if (!payload?.error) {
    return false;
  }

  const message = payload.error.toLowerCase();
  return (
    (message.includes("country") && message.includes("not allowed")) ||
    message.includes("region") ||
    message.includes("geo") ||
    message.includes("blocked") ||
    message.includes("restricted") ||
    message.includes("free tier")
  );
}

async function requestTempmailJson<T>(input: string, init?: RequestInit) {
  try {
    return await requestJson<T>(input, init, {
      provider: descriptor.id,
      expectedStatus: [200, 201],
    });
  } catch (error) {
    if (error instanceof AppError && error.status === 403) {
      const payload = toRestrictionPayload(error);
      if (isGeoRestriction(payload)) {
        throw providerError(
          "PROVIDER_ACCESS_RESTRICTED",
          "TempMail.lol 免费接口当前限制该网络区域访问，请切换其他 provider，或使用其 Plus / Ultra 服务。",
          403,
          descriptor.id,
          false,
          {
            upstreamMessage: payload?.error,
            captchaRequired: payload?.captcha_required,
          }
        );
      }
    }

    throw error;
  }
}

export const tempmailLolAdapter: ProviderAdapter = {
  descriptor,
  async createMailbox(input: CreateMailboxInput) {
    const payload: Record<string, string> = {};

    if (input.alias?.trim()) {
      payload.prefix = input.alias.trim();
    }

    if (input.domain?.trim()) {
      payload.domain = input.domain.trim();
    }

    const result = await requestTempmailJson<TempmailCreateResponse>("https://api.tempmail.lol/v2/inbox/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const address = result.address ?? result.email;
    if (!address || !result.token) {
      throw providerError(
        "PROVIDER_RESPONSE_INVALID",
        "TempMail.lol 返回的数据不完整。",
        502,
        descriptor.id,
        true
      );
    }

    return {
      id: randomUUID(),
      provider: descriptor.id,
      providerLabel: descriptor.name,
      address: parseAddress(address),
      accessMode: descriptor.accessMode,
      capabilities: descriptor.capabilities,
      createdAt: new Date().toISOString(),
      expiresAt: result.expiresAt ?? result.expires_at ?? null,
      metadata: {
        token: result.token,
      },
    } as MailboxSession;
  },
  async listMessages(context: ProviderContext) {
    const token = context.mailbox.metadata?.token;
    if (!token) {
      throw providerError("MAILBOX_ACCESS_DENIED", "缺少 inbox token。", 400, descriptor.id);
    }

    const url = new URL("https://api.tempmail.lol/v2/inbox");
    url.searchParams.set("token", token);

    const result = await requestTempmailJson<TempmailListResponse>(url.toString());

    return (result.emails ?? []).map((item) => mapMessage(context.mailbox.id, item));
  },
  async getMessage(context: ProviderContext, messageId: string) {
    const messages = await this.listMessages(context);
    const target = messages.find((item) => item.id === messageId);

    if (!target) {
      throw providerError("MESSAGE_NOT_FOUND", "目标邮件不存在。", 404, descriptor.id);
    }

    const token = context.mailbox.metadata?.token;
    const url = new URL("https://api.tempmail.lol/v2/inbox");
    url.searchParams.set("token", token ?? "");
    const result = await requestTempmailJson<TempmailListResponse>(url.toString());
    const full = (result.emails ?? []).find((item) => mapMessage(context.mailbox.id, item).id === messageId);

    if (!full) {
      throw providerError("MESSAGE_NOT_FOUND", "目标邮件不存在。", 404, descriptor.id);
    }

    return {
      ...target,
      html: full.html ?? null,
      text: full.body ?? null,
      attachments: [],
    } as MessageDetail;
  },
};
