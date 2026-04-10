import { randomUUID } from "node:crypto";

import { providerError } from "@/lib/tpmail/errors";
import { CreateMailboxInput, MailboxSession, ProviderDomainOption, ProviderId } from "@/lib/tpmail/types";
import { deleteMailbox, readCache, readMailbox, saveMailbox, writeCache } from "@/server/tpmail/store";
import { getProviderAdapter, listProviderDescriptors } from "@/server/tpmail/providers";

const PROVIDER_CACHE_KEY = "providers:descriptors";
const PROVIDER_CACHE_TTL_MS = 5 * 60 * 1000;
const PROVIDER_DOMAINS_CACHE_TTL_MS = 3 * 60 * 1000;
const ALIAS_PATTERN = /^[a-zA-Z0-9._-]+$/;

function normalizeAlias(alias?: string) {
  const trimmed = alias?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (!ALIAS_PATTERN.test(trimmed)) {
    throw providerError(
      "INVALID_REQUEST",
      "邮箱前缀只允许字母、数字、点、下划线和短横线。",
      400,
      undefined,
      false,
      {
        alias: trimmed,
      }
    );
  }

  return trimmed;
}

export function listProviders() {
  return listProvidersWithCacheInfo().providers;
}

export function listProvidersWithCacheInfo() {
  const cached = readCache<ReturnType<typeof listProviderDescriptors>>(PROVIDER_CACHE_KEY);
  if (cached) {
    return {
      providers: cached,
      cacheStatus: "hit" as const,
    };
  }

  const providers = listProviderDescriptors();
  writeCache(PROVIDER_CACHE_KEY, providers, PROVIDER_CACHE_TTL_MS);
  return {
    providers,
    cacheStatus: "miss" as const,
  };
}

export async function listProviderDomains(providerId: ProviderId) {
  return (await listProviderDomainsWithCacheInfo(providerId)).domains;
}

export async function listProviderDomainsWithCacheInfo(providerId: ProviderId) {
  const adapter = getProviderAdapter(providerId);

  if (!adapter) {
    throw providerError("INVALID_REQUEST", "未知 provider。", 400, providerId);
  }

  const cacheKey = `providers:${providerId}:domains`;
  const cached = readCache<ProviderDomainOption[]>(cacheKey);
  if (cached) {
    return {
      domains: cached,
      cacheStatus: "hit" as const,
    };
  }

  const domains = adapter.listDomains
    ? await adapter.listDomains()
    : adapter.descriptor.defaultDomain
      ? [
          {
            provider: adapter.descriptor.id,
            domain: adapter.descriptor.defaultDomain,
            label: adapter.descriptor.defaultDomain,
            isDefault: true,
          },
        ]
      : [];

  if (domains.length > 0) {
    writeCache(cacheKey, domains, PROVIDER_DOMAINS_CACHE_TTL_MS);
  }

  return {
    domains,
    cacheStatus: "miss" as const,
  };
}

export async function createMailbox(input: CreateMailboxInput) {
  const normalizedAlias = normalizeAlias(input.alias);
  const adapter = getProviderAdapter(input.provider);

  if (!adapter) {
    throw providerError("INVALID_REQUEST", "未知 provider。", 400);
  }

  if (!adapter.descriptor.enabled) {
    throw providerError("PROVIDER_DISABLED", "该 provider 当前未启用。", 503, input.provider);
  }

  const requestedDomain = input.domain?.trim();
  if (requestedDomain) {
    if (adapter.descriptor.capabilities.customDomain && !adapter.listDomains) {
      // 由 provider 自身决定自定义域名是否合法。
    } else {
      const allowedDomains = await listProviderDomains(input.provider);

      if (allowedDomains.length === 0) {
        throw providerError(
          "UNSUPPORTED_OPERATION",
          "当前 provider 暂不支持自定义后缀选择。",
          400,
          input.provider
        );
      }

      const isAllowed = allowedDomains.some((item) => item.domain === requestedDomain);
      if (!isAllowed) {
        throw providerError(
          "INVALID_REQUEST",
          "所选邮箱后缀不在当前 provider 的可用范围内。",
          400,
          input.provider,
          false,
          {
            requestedDomain,
          }
        );
      }
    }
  }

  const mailbox = await adapter.createMailbox({
    ...input,
    alias: normalizedAlias,
  });
  if (!mailbox.id) {
    mailbox.id = randomUUID();
  }

  saveMailbox(mailbox);
  return mailbox;
}

export function toPublicMailbox(mailbox: MailboxSession) {
  return {
    id: mailbox.id,
    provider: mailbox.provider,
    providerLabel: mailbox.providerLabel,
    address: mailbox.address,
    accessMode: mailbox.accessMode,
    capabilities: mailbox.capabilities,
    createdAt: mailbox.createdAt,
    expiresAt: mailbox.expiresAt,
  } satisfies Omit<MailboxSession, "metadata">;
}

export function getMailboxOrThrow(mailboxId: string) {
  const mailbox = readMailbox(mailboxId);
  if (!mailbox) {
    throw providerError("NOT_FOUND", "邮箱会话不存在或已失效。", 404);
  }

  if (mailbox.expiresAt && new Date(mailbox.expiresAt).getTime() <= Date.now()) {
    deleteMailbox(mailboxId);
    throw providerError("MAILBOX_EXPIRED", "邮箱会话已过期，请重新生成地址。", 410, mailbox.provider);
  }

  return mailbox;
}

export async function listMailboxMessages(mailboxId: string) {
  const mailbox = getMailboxOrThrow(mailboxId);
  const adapter = getProviderAdapter(mailbox.provider);
  return adapter.listMessages({ mailbox });
}

export async function getMailboxMessage(mailboxId: string, messageId: string) {
  const mailbox = getMailboxOrThrow(mailboxId);
  const adapter = getProviderAdapter(mailbox.provider as ProviderId);
  return adapter.getMessage({ mailbox }, messageId);
}

export async function getAttachmentRedirect(mailboxId: string, messageId: string, attachmentId: string) {
  const mailbox = getMailboxOrThrow(mailboxId);
  const adapter = getProviderAdapter(mailbox.provider);
  if (!adapter.getAttachmentUrl) {
    throw providerError(
      "UNSUPPORTED_OPERATION",
      "当前 provider 暂不支持附件下载。",
      400,
      mailbox.provider
    );
  }

  return adapter.getAttachmentUrl({ mailbox }, messageId, attachmentId);
}
