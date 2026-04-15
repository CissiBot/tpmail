"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  MAILBOX_SNAPSHOT_HEADER,
  decodeMailboxSnapshot,
  encodeMailboxSnapshot,
  isBrowserManagedMailboxSession,
  isMailboxSnapshot,
} from "@/lib/tpmail/mailbox-snapshot";
import { PROVIDER_API_KEY_HEADER } from "@/lib/tpmail/provider-credentials";
import {
  MailboxSession,
  MessageDetail,
  MessageSummary,
  ProviderDescriptor,
  ProviderDomainOption,
  ProviderId,
} from "@/lib/tpmail/types";
import { formatRelativeExpiry, parseAddress, randomLocalPart } from "@/lib/tpmail/utils";

const MAILBOX_STORAGE_KEY = "tpmail:last-mailbox";
const MAILBOX_HISTORY_STORAGE_KEY = "tpmail:mailbox-history";
const PROVIDER_STORAGE_KEY = "tpmail:selected-provider";
const PROVIDER_CREDENTIALS_STORAGE_KEY = "tpmail:provider-credentials";
const MAX_RECENT_MAILBOXES = 8;

type ErrorLike = {
  error?: {
    message?: string;
  };
};

type ProviderApiKeyState = Partial<Record<ProviderId, string>>;

function getMailboxIdentity(mailbox: MailboxSession) {
  return [
    mailbox.provider,
    mailbox.address.address,
    mailbox.metadata?.token ?? "",
    mailbox.metadata?.apiKey ?? "",
  ].join("::");
}

function upsertRecentMailboxes(list: MailboxSession[], mailbox: MailboxSession) {
  const nextIdentity = getMailboxIdentity(mailbox);
  return [mailbox, ...list.filter((item) => getMailboxIdentity(item) !== nextIdentity)].slice(0, MAX_RECENT_MAILBOXES);
}

function removeRecentMailbox(list: MailboxSession[], mailbox: MailboxSession) {
  const nextIdentity = getMailboxIdentity(mailbox);
  return list.filter((item) => getMailboxIdentity(item) !== nextIdentity);
}

function parseStoredRecentMailboxes(value: string | null) {
  if (!value) {
    return [] as MailboxSession[];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [] as MailboxSession[];
    }

    return parsed.filter(isMailboxSnapshot).slice(0, MAX_RECENT_MAILBOXES);
  } catch {
    return [] as MailboxSession[];
  }
}

function parseStoredProviderApiKeys(value: string | null): ProviderApiKeyState {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [ProviderId, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
    );
  } catch {
    return {};
  }
}

function isImportedAddressUnverified(mailbox: MailboxSession) {
  return mailbox.metadata?.addressVerified === "false";
}

function getMailboxDisplayAddress(mailbox: MailboxSession) {
  return isImportedAddressUnverified(mailbox) ? `${mailbox.address.address}（未校验）` : mailbox.address.address;
}

type IconProps = {
  className?: string;
};

function InboxIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5Z" />
      <path d="m5 8 7 5 7-5" />
    </svg>
  );
}

function RefreshIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M20 5v5h-5" />
      <path d="M20 10a8 8 0 0 0-14.2-4.8" />
      <path d="M4 19v-5h5" />
      <path d="M4 14a8 8 0 0 0 14.2 4.8" />
    </svg>
  );
}

function CopyIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M5 15V7a2 2 0 0 1 2-2h8" />
    </svg>
  );
}

function DotIcon({ className = "h-2.5 w-2.5" }: IconProps) {
  return <span className={`inline-block rounded-full bg-current ${className}`} aria-hidden="true" />;
}

function ExternalIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M14 5h5v5" />
      <path d="M10 14 19 5" />
      <path d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
    </svg>
  );
}

function PaperclipIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="m21 11-8.6 8.6a5 5 0 1 1-7.1-7.1L14 3.8a3.5 3.5 0 0 1 5 5L9.7 18.1a2 2 0 1 1-2.8-2.8l8.5-8.5" />
    </svg>
  );
}

function ShuffleIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M16 3h4v4" />
      <path d="M4 20 20 4" />
      <path d="M20 14v6h-6" />
      <path d="m15 15 5 5" />
      <path d="M4 4h5l3 3" />
    </svg>
  );
}

function EmptyMailIcon({ className = "h-12 w-12" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <rect x="4" y="6" width="16" height="12" rx="2.5" />
      <path d="m5 8 7 5 7-5" />
    </svg>
  );
}

function formatAccessMode(mode: MailboxSession["accessMode"]) {
  switch (mode) {
    case "public_address":
      return "公共地址访问";
    case "inbox_token":
      return "邮箱 token";
    case "account_token":
      return "账号 token";
    case "api_key":
      return "API Key";
    default:
      return mode;
  }
}

function getInitialProvider(providers: ProviderDescriptor[]) {
  const preferred = providers.find((provider) => provider.id === "duckmail" && provider.enabled);
  if (preferred) {
    return preferred.id;
  }

  return providers.find((provider) => provider.enabled)?.id ?? providers[0]?.id ?? "catchmail";
}

function getTierAccent(provider: ProviderDescriptor) {
  if (!provider.enabled) {
    return "text-stone-500";
  }

  switch (provider.tier) {
    case "L1":
      return "text-emerald-300";
    case "L2":
      return "text-sky-300";
    case "L3":
      return "text-amber-300";
    default:
      return "text-stone-300";
  }
}

function getTierBadge(provider: ProviderDescriptor) {
  if (!provider.enabled) {
    return "border-white/8 bg-white/[0.03] text-stone-500";
  }

  switch (provider.tier) {
    case "L1":
      return "border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
    case "L2":
      return "border-sky-400/20 bg-sky-400/10 text-sky-200";
    case "L3":
      return "border-amber-400/20 bg-amber-400/10 text-amber-200";
    default:
      return "border-white/8 bg-white/[0.03] text-stone-300";
  }
}

function getAvailabilityBadge(provider: ProviderDescriptor) {
  return provider.enabled
    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
    : "border-red-400/15 bg-red-400/8 text-red-200";
}

function SidebarAction({
  active = false,
  children,
  icon,
  onClick,
  disabled = false,
}: {
  active?: boolean;
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-14 w-full items-center gap-3 rounded-2xl px-4 text-left text-base transition ${
        active
          ? "bg-[#1d1f47] text-[#7cc0ff]"
          : "text-slate-200 hover:bg-white/[0.03] disabled:cursor-not-allowed disabled:text-slate-500"
      }`}
    >
      <span className={active ? "text-[#7cc0ff]" : "text-slate-300"}>{icon}</span>
      <span>{children}</span>
    </button>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex min-h-8 items-center rounded-full border border-white/8 bg-white/[0.02] px-3 text-xs font-medium text-stone-400">
      {children}
    </span>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-10">
      <div className="flex max-w-xl flex-col items-center text-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/[0.015] text-stone-300">
          <EmptyMailIcon className="h-14 w-14" />
        </div>
        <h2 className="mt-7 text-[32px] font-semibold tracking-tight text-stone-100">{title}</h2>
        <p className="mt-4 text-base leading-8 text-stone-400">{description}</p>
        {action ? <div className="mt-8">{action}</div> : null}
      </div>
    </div>
  );
}

export function AppShell({ initialProviders }: { initialProviders: ProviderDescriptor[] }) {
  const [providers] = useState(initialProviders);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(() => getInitialProvider(initialProviders));
  const [mailbox, setMailbox] = useState<MailboxSession | null>(null);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [activeMessage, setActiveMessage] = useState<MessageDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingMessageId, setLoadingMessageId] = useState<string | null>(null);
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState<string | null>(null);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [notice, setNotice] = useState<string>("选择一个聚合源，然后创建临时邮箱地址。系统会自动轮询收件箱。 ");
  const [aliasInput, setAliasInput] = useState("");
  const [importAddressInput, setImportAddressInput] = useState("");
  const [importTokenInput, setImportTokenInput] = useState("");
  const [domainOptions, setDomainOptions] = useState<ProviderDomainOption[]>([]);
  const [selectedDomain, setSelectedDomain] = useState("");
  const [providerApiKeys, setProviderApiKeys] = useState<ProviderApiKeyState>({});
  const [recentMailboxes, setRecentMailboxes] = useState<MailboxSession[]>([]);

  const selectedProviderMeta = useMemo(
    () => providers.find((provider) => provider.id === selectedProvider) ?? providers[0],
    [providers, selectedProvider]
  );

  const enabledProviders = useMemo(() => providers.filter((provider) => provider.enabled), [providers]);
  const otherProviders = useMemo(
    () => providers.filter((provider) => provider.id !== selectedProvider),
    [providers, selectedProvider]
  );

  const selectedProviderApiKey = providerApiKeys[selectedProvider]?.trim() ?? "";
  const canImportSession = useMemo(() => {
    const address = importAddressInput.trim();
    if (!address) {
      return false;
    }

    if (selectedProviderMeta.accessMode === "account_token" || selectedProviderMeta.accessMode === "inbox_token") {
      return importTokenInput.trim().length > 0;
    }

    if (selectedProviderMeta.accessMode === "api_key") {
      return selectedProviderApiKey.length > 0;
    }

    return true;
  }, [importAddressInput, importTokenInput, selectedProviderApiKey, selectedProviderMeta.accessMode]);

  const buildMailboxSnapshotValue = useCallback((currentMailbox: MailboxSession) => encodeMailboxSnapshot(currentMailbox), []);

  const buildProviderCredentialHeaders = useCallback(
    (providerId: ProviderId) => {
      const apiKey = providerApiKeys[providerId]?.trim();
      if (!apiKey) {
        return undefined;
      }

      return {
        [PROVIDER_API_KEY_HEADER]: apiKey,
      };
    },
    [providerApiKeys]
  );

  const buildMailboxRequestHeaders = useCallback(
    (currentMailbox?: MailboxSession | null) => {
      if (!currentMailbox) {
        return undefined;
      }

      return {
        [MAILBOX_SNAPSHOT_HEADER]: buildMailboxSnapshotValue(currentMailbox),
      };
    },
    [buildMailboxSnapshotValue]
  );

  const clearStoredMailbox = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.removeItem(MAILBOX_STORAGE_KEY);
  }, []);

  const validateImportAddress = useCallback(
    (mailboxAddress: ReturnType<typeof parseAddress>) => {
      if (selectedProvider === "maildrop" && mailboxAddress.domain !== "maildrop.cc") {
        throw new Error("Maildrop 只支持导入 maildrop.cc 域名。 ");
      }

      if (domainOptions.length > 0 && selectedProvider !== "catchmail") {
        const isAllowed = domainOptions.some((item) => item.domain === mailboxAddress.domain);
        if (!isAllowed) {
          throw new Error("输入的邮箱后缀不在当前 provider 的可用域名范围内。 ");
        }
      }
    },
    [domainOptions, selectedProvider]
  );

  const validateImportedMailbox = useCallback(
    async (targetMailbox: MailboxSession) => {
      const response = await fetch(`/api/mailboxes/${targetMailbox.id}/messages`, {
        cache: "no-store",
        headers: buildMailboxRequestHeaders(targetMailbox),
      });
      const data = (await response.json()) as { messages?: MessageSummary[] } & ErrorLike;

      if (!response.ok || !data.messages) {
        throw new Error(data.error?.message ?? "导入会话校验失败");
      }

      return data.messages;
    },
    [buildMailboxRequestHeaders]
  );

  const activateMailbox = useCallback(
    (nextMailbox: MailboxSession, nextNotice?: string) => {
      setSelectedProvider(nextMailbox.provider);
      setAliasInput(nextMailbox.address.localPart);
      setSelectedDomain(nextMailbox.address.domain);
      setMailbox(nextMailbox);
      setMessages([]);
      setActiveMessage(null);
      setDownloadingAttachmentId(null);
      if (nextMailbox.metadata?.apiKey) {
        setProviderApiKeys((current) => ({
          ...current,
          [nextMailbox.provider]: nextMailbox.metadata?.apiKey ?? "",
        }));
      }
      setRecentMailboxes((current) => upsertRecentMailboxes(current, nextMailbox));
      if (nextNotice) {
        setNotice(nextNotice);
      }
    },
    []
  );

  function resetWorkspace(nextProvider: ProviderDescriptor) {
    setSelectedProvider(nextProvider.id);
    setMailbox(null);
    setMessages([]);
    setActiveMessage(null);
    setDownloadingAttachmentId(null);
    setSelectedDomain("");
    setImportAddressInput("");
    setImportTokenInput("");
    clearStoredMailbox();
    setNotice(
      nextProvider.enabled
        ? `已切换到 ${nextProvider.name}，现在可以创建新的临时邮箱。`
        : `${nextProvider.name} 当前未启用，暂时不能创建会话。`
    );
  }

  async function createMailboxSession(provider: ProviderId, overrides?: { alias?: string; domain?: string }) {
    const nextAlias = overrides?.alias ?? (aliasInput.trim() || undefined);
    const nextDomain = overrides?.domain ?? (selectedDomain || undefined);
    const apiKey = providerApiKeys[provider]?.trim() || undefined;

    setBusy(true);
    setNotice("正在创建邮箱地址...");
    setMailbox(null);
    setMessages([]);
    setActiveMessage(null);

    try {
      const response = await fetch("/api/mailboxes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider,
          alias: nextAlias,
          domain: nextDomain,
          apiKey,
        }),
      });
      const data = (await response.json()) as { mailbox?: MailboxSession } & ErrorLike;

      if (!response.ok || !data.mailbox) {
        throw new Error(data.error?.message ?? "创建邮箱失败");
      }

      activateMailbox(
        data.mailbox,
        isBrowserManagedMailboxSession(data.mailbox)
          ? `已创建 ${data.mailbox.providerLabel} 邮箱，当前会话已保存在这个浏览器中。`
          : `已创建 ${data.mailbox.providerLabel} 邮箱，系统正在同步最新收件箱。`
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建邮箱失败");
    } finally {
      setBusy(false);
    }
  }

  async function importMailboxSession() {
    const trimmedAddress = importAddressInput.trim();
    if (!trimmedAddress) {
      setNotice("请先输入要接管的邮箱地址。");
      return;
    }

    let parsedAddress;
    try {
      parsedAddress = parseAddress(trimmedAddress);
      validateImportAddress(parsedAddress);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "邮箱地址格式无效，请检查后重试。");
      return;
    }

    const metadata: Record<string, string> = {};
    if (selectedProviderMeta.accessMode === "account_token" || selectedProviderMeta.accessMode === "inbox_token") {
      const token = importTokenInput.trim();
      if (!token) {
        setNotice("请先输入 token，再接管这个邮箱。 ");
        return;
      }

      metadata.token = token;
      metadata.addressVerified = "false";
    }

    if (selectedProviderMeta.accessMode === "api_key") {
      if (!selectedProviderApiKey) {
        setNotice("请先输入你的 API key，再接管这个邮箱。 ");
        return;
      }

      metadata.apiKey = selectedProviderApiKey;
    }

    const importedMailbox: MailboxSession = {
      id: globalThis.crypto.randomUUID(),
      provider: selectedProviderMeta.id,
      providerLabel: selectedProviderMeta.name,
      address: parsedAddress,
      accessMode: selectedProviderMeta.accessMode,
      capabilities: selectedProviderMeta.capabilities,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };

    setBusy(true);
    setNotice("正在校验你导入的邮箱会话...");

    try {
      await validateImportedMailbox(importedMailbox);
      activateMailbox(
        importedMailbox,
        isImportedAddressUnverified(importedMailbox)
          ? `已接管 ${importedMailbox.address.address}，但该地址尚未由上游校验。`
          : `已接管 ${importedMailbox.address.address}，当前会话只保存在这个浏览器中。`
      );
      setImportAddressInput("");
      setImportTokenInput("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "导入会话校验失败");
    } finally {
      setBusy(false);
    }
  }

  function removeMailboxFromHistory(targetMailbox: MailboxSession) {
    setRecentMailboxes((current) => removeRecentMailbox(current, targetMailbox));
    if (mailbox && getMailboxIdentity(mailbox) === getMailboxIdentity(targetMailbox)) {
      setMailbox(null);
      setMessages([]);
      setActiveMessage(null);
      setDownloadingAttachmentId(null);
      clearStoredMailbox();
      setNotice("已从最近邮箱列表移除当前会话。 ");
    }
  }

  function applyRandomAlias() {
    setAliasInput(randomLocalPart());
  }

  function createRandomMailbox() {
    const alias = randomLocalPart();
    setAliasInput(alias);
    void createMailboxSession(selectedProvider, {
      alias,
    });
  }

  const refreshMessages = useCallback(
    async (currentMailbox?: MailboxSession | null) => {
      const targetMailbox = currentMailbox ?? mailbox;
      if (!targetMailbox) {
        return;
      }

      setLoadingMessages(true);
      try {
        const response = await fetch(`/api/mailboxes/${targetMailbox.id}/messages`, {
          cache: "no-store",
          headers: buildMailboxRequestHeaders(targetMailbox),
        });
        const data = (await response.json()) as { messages?: MessageSummary[] } & ErrorLike;

        if (!response.ok || !data.messages) {
          const shouldDiscardMailbox =
            response.status === 404 ||
            response.status === 410 ||
            (isBrowserManagedMailboxSession(targetMailbox) && (response.status === 400 || response.status === 401));

          if (shouldDiscardMailbox) {
            clearStoredMailbox();
            setRecentMailboxes((current) => removeRecentMailbox(current, targetMailbox));
            setMailbox((current) => (current?.id === targetMailbox.id ? null : current));
            setMessages([]);
            setActiveMessage(null);
          }

          throw new Error(data.error?.message ?? "收件箱拉取失败");
        }

        const nextMessages = data.messages;

        setMessages(nextMessages);
        setActiveMessage((current) => {
          if (!current) {
            return current;
          }

          return nextMessages.some((item) => item.id === current.id) ? current : null;
        });
        setNotice(
          nextMessages.length > 0
            ? `已同步 ${nextMessages.length} 封邮件。`
            : "收件箱当前为空，系统会继续自动刷新。"
        );
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "收件箱拉取失败");
      } finally {
        setLoadingMessages(false);
      }
    },
    [buildMailboxRequestHeaders, clearStoredMailbox, mailbox]
  );

  async function openMessage(messageId: string) {
    if (!mailbox) {
      return;
    }

    setLoadingMessageId(messageId);
    try {
      const response = await fetch(`/api/mailboxes/${mailbox.id}/messages/${messageId}`, {
        cache: "no-store",
        headers: buildMailboxRequestHeaders(mailbox),
      });
      const data = (await response.json()) as { message?: MessageDetail } & ErrorLike;

      if (!response.ok || !data.message) {
        throw new Error(data.error?.message ?? "邮件读取失败");
      }

      setActiveMessage(data.message);
      setNotice("邮件详情已更新，HTML 内容会在隔离容器中显示。 ");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "邮件读取失败");
    } finally {
      setLoadingMessageId(null);
    }
  }

  async function downloadAttachment(messageId: string, attachmentId: string) {
    if (!mailbox) {
      return;
    }

    setDownloadingAttachmentId(attachmentId);
    try {
      const response = await fetch(`/api/mailboxes/${mailbox.id}/messages/${messageId}/attachments/${attachmentId}`, {
        cache: "no-store",
        headers: {
          ...buildMailboxRequestHeaders(mailbox),
          "x-tpmail-download-mode": "json",
        },
      });

      const data = (await response.json()) as { url?: string } & ErrorLike;
      if (!response.ok || !data.url) {
        throw new Error(data.error?.message ?? "附件下载失败");
      }

      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "附件下载失败");
    } finally {
      setDownloadingAttachmentId(null);
    }
  }

  async function copyAddress() {
    if (!mailbox) {
      return;
    }

    try {
      await navigator.clipboard.writeText(mailbox.address.address);
      setNotice(isImportedAddressUnverified(mailbox) ? "邮箱地址已复制，但这是你导入时填写的地址，尚未由上游校验。" : "邮箱地址已复制到剪贴板。");
    } catch {
      setNotice("复制邮箱地址失败，请手动复制。");
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedProviderId = window.localStorage.getItem(PROVIDER_STORAGE_KEY);
    const storedProvider = providers.find((provider) => provider.id === storedProviderId);
    if (storedProvider) {
      setSelectedProvider(storedProvider.id);
    }

    setProviderApiKeys(parseStoredProviderApiKeys(window.localStorage.getItem(PROVIDER_CREDENTIALS_STORAGE_KEY)));
    setRecentMailboxes(parseStoredRecentMailboxes(window.localStorage.getItem(MAILBOX_HISTORY_STORAGE_KEY)));

    const storedMailboxValue = window.localStorage.getItem(MAILBOX_STORAGE_KEY);
    const storedMailbox = decodeMailboxSnapshot(storedMailboxValue);
    if (!storedMailbox) {
      if (storedMailboxValue) {
        window.localStorage.removeItem(MAILBOX_STORAGE_KEY);
      }
      return;
    }

    const matchedProvider = providers.find((provider) => provider.id === storedMailbox.provider);
    if (matchedProvider) {
      setSelectedProvider(matchedProvider.id);
    }

    activateMailbox(
      storedMailbox,
      isBrowserManagedMailboxSession(storedMailbox)
        ? "已从当前浏览器恢复邮箱，后续读信会直接使用本地凭据与快照。"
        : "已从当前浏览器恢复邮箱，正在尝试复用服务端会话。"
    );
  }, [activateMailbox, providers]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(PROVIDER_STORAGE_KEY, selectedProvider);
  }, [selectedProvider]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextEntries = Object.entries(providerApiKeys).filter((entry) => entry[1]?.trim());
    if (nextEntries.length === 0) {
      window.localStorage.removeItem(PROVIDER_CREDENTIALS_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(PROVIDER_CREDENTIALS_STORAGE_KEY, JSON.stringify(Object.fromEntries(nextEntries)));
  }, [providerApiKeys]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (recentMailboxes.length === 0) {
      window.localStorage.removeItem(MAILBOX_HISTORY_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(MAILBOX_HISTORY_STORAGE_KEY, JSON.stringify(recentMailboxes));
  }, [recentMailboxes]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!mailbox) {
      window.localStorage.removeItem(MAILBOX_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(MAILBOX_STORAGE_KEY, buildMailboxSnapshotValue(mailbox));
    setRecentMailboxes((current) => upsertRecentMailboxes(current, mailbox));
  }, [buildMailboxSnapshotValue, mailbox]);

  useEffect(() => {
    if (!mailbox) {
      return;
    }

    refreshMessages(mailbox);
    const timer = window.setInterval(() => {
      refreshMessages(mailbox);
    }, 15000);

    return () => window.clearInterval(timer);
  }, [mailbox, refreshMessages]);

  useEffect(() => {
    let cancelled = false;

    async function loadDomains() {
      if (!selectedProviderMeta.enabled) {
        setDomainOptions([]);
        setSelectedDomain("");
        return;
      }

      if (selectedProviderMeta.accessMode === "api_key" && !selectedProviderApiKey) {
        setDomainOptions([]);
        setSelectedDomain("");
        return;
      }

      setLoadingDomains(true);
      try {
        const response = await fetch(`/api/providers/${selectedProviderMeta.id}/domains`, {
          cache: "no-store",
          headers: buildProviderCredentialHeaders(selectedProviderMeta.id),
        });
        const data = (await response.json()) as { domains?: ProviderDomainOption[] } & ErrorLike;

        if (!response.ok || !data.domains) {
          throw new Error(data.error?.message ?? "域名列表获取失败");
        }

        if (cancelled) {
          return;
        }

        const nextDomains = data.domains;

        setDomainOptions(nextDomains);
        setSelectedDomain((current) => {
          if (nextDomains.some((item) => item.domain === current)) {
            return current;
          }

          return nextDomains.find((item) => item.isDefault)?.domain ?? nextDomains[0]?.domain ?? "";
        });
      } catch (error) {
        if (!cancelled) {
          setDomainOptions([]);
          setSelectedDomain("");
          setNotice(error instanceof Error ? error.message : "域名列表获取失败");
        }
      } finally {
        if (!cancelled) {
          setLoadingDomains(false);
        }
      }
    }

    loadDomains();

    return () => {
      cancelled = true;
    };
  }, [buildProviderCredentialHeaders, selectedProviderApiKey, selectedProviderMeta]);

  return (
    <div className="min-h-dvh bg-[#1d1f20] text-stone-100">
      <div className="flex min-h-dvh flex-col lg:flex-row">
        <aside className="w-full shrink-0 border-b border-white/10 bg-[#191b1c] lg:flex lg:h-dvh lg:w-[288px] lg:flex-col lg:border-b-0 lg:border-r">
          <div className="border-b border-white/10 px-5 py-5">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#27292b] text-[#f5c95f]">
                <InboxIcon className="h-4.5 w-4.5" />
              </div>
              <div>
                <p className="text-[15px] font-semibold tracking-tight text-stone-100">TPMail</p>
                <p className="text-sm text-stone-400">临时邮箱聚合</p>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-5 py-5">
            <div className="shrink-0 space-y-2">
              <SidebarAction active icon={<InboxIcon />}>
                收件箱
              </SidebarAction>
              <SidebarAction onClick={() => refreshMessages()} disabled={!mailbox || loadingMessages} icon={<RefreshIcon />}>
                {loadingMessages ? "刷新中" : "刷新"}
              </SidebarAction>
            </div>

            <section className="mt-7 flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="mb-3 flex shrink-0 items-center justify-between text-xs uppercase tracking-[0.18em] text-stone-500">
                <span>聚合源</span>
                <span>{enabledProviders.length} 个在线</span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => resetWorkspace(selectedProviderMeta)}
                    className="w-full rounded-[20px] border border-transparent bg-[#1d1f47] px-3.5 py-3 text-left text-stone-100"
                  >
                    <div className="space-y-2.5">
                      <p className="text-[14px] font-semibold leading-5 text-[#9bd0ff]">{selectedProviderMeta.name}</p>
                      <div className="flex flex-wrap gap-1.5">
                        <span className={`inline-flex min-h-6 items-center rounded-full border px-2 text-[11px] font-medium ${getTierBadge(selectedProviderMeta)}`}>
                          {selectedProviderMeta.tier}
                        </span>
                        <span className={`inline-flex min-h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-medium ${getAvailabilityBadge(selectedProviderMeta)}`}>
                          <DotIcon className="h-2 w-2" />
                          {selectedProviderMeta.enabled ? "可用" : "关闭"}
                        </span>
                      </div>
                    </div>
                  </button>

                  {otherProviders.length > 0 ? (
                    <div className="space-y-2">
                      {otherProviders.map((provider) => (
                        <button
                          key={provider.id}
                          type="button"
                          onClick={() => resetWorkspace(provider)}
                          className={`flex min-h-9 w-full items-center justify-between gap-3 rounded-full border px-3 text-left transition ${
                            provider.enabled
                              ? "border-white/8 bg-white/[0.02] text-stone-200 hover:bg-white/[0.04]"
                              : "border-white/6 bg-transparent text-stone-500 opacity-70"
                          }`}
                        >
                          <p className="truncate text-[12px] font-medium">{provider.name}</p>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span className={`inline-flex h-2.5 w-2.5 rounded-full ${provider.enabled ? "bg-emerald-300" : "bg-stone-500"}`} aria-hidden="true" />
                            <span className={`text-[11px] font-medium ${getTierAccent(provider)}`}>{provider.enabled ? provider.tier : `${provider.tier} / 关闭`}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="mt-5 shrink-0 border-t border-white/10 pt-5">
              <div className="space-y-4">
                <div className="space-y-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-stone-500">地址参数</div>
                  <label className="block space-y-2">
                    <span className="text-xs text-stone-500">邮箱前缀</span>
                    <div className="relative">
                      <input
                        value={aliasInput}
                        onChange={(event) => setAliasInput(event.target.value.replace(/[^a-zA-Z0-9._-]/g, ""))}
                        placeholder="例如 inbox-demo"
                        className="min-h-12 w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 pr-12 text-[15px] text-stone-100 outline-none placeholder:text-stone-500 focus:border-[#4e6bd8]"
                      />
                      <button
                        type="button"
                        onClick={applyRandomAlias}
                        aria-label="随机生成前缀"
                        className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-xl text-stone-300 transition hover:bg-white/[0.05]"
                      >
                        <ShuffleIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </label>

                  <div className="space-y-2">
                    <span className="text-xs text-stone-500">邮箱后缀</span>
                    <div className="min-h-12 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-[15px] text-stone-100">
                      {selectedDomain ||
                        (selectedProviderMeta.accessMode === "api_key" && !selectedProviderApiKey
                          ? "先输入 API key 再载入域名"
                          : loadingDomains
                            ? "载入中..."
                            : "自动分配 / 固定域名")}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {domainOptions.length === 0 ? (
                        <span className="w-full rounded-full border border-dashed border-white/8 px-3 py-2 text-sm text-stone-500">
                          {loadingDomains ? "后缀载入中..." : "当前 provider 没有可选后缀。"}
                        </span>
                      ) : (
                        domainOptions.map((option) => {
                          const active = option.domain === selectedDomain;

                          return (
                            <button
                              key={`${option.provider}:${option.domain}`}
                              type="button"
                              onClick={() => setSelectedDomain(option.domain)}
                              className={`min-h-8 w-[calc(50%-4px)] rounded-full border px-2.5 text-left text-[12px] transition ${
                                active
                                  ? "border-transparent bg-[#1d1f47] text-[#9bd0ff]"
                                  : "border-white/8 bg-white/[0.02] text-stone-300 hover:bg-white/[0.04]"
                              }`}
                            >
                              {option.label}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {selectedProviderMeta.accessMode === "api_key" ? (
                    <label className="block space-y-2">
                      <span className="text-xs text-stone-500">你的 API key</span>
                      <input
                        value={selectedProviderApiKey}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setProviderApiKeys((current) => {
                            if (!nextValue.trim()) {
                              const nextState = { ...current };
                              delete nextState[selectedProvider];
                              return nextState;
                            }

                            return {
                              ...current,
                              [selectedProvider]: nextValue,
                            };
                          });
                        }}
                        placeholder="粘贴你自己的 Inboxes / RapidAPI key"
                        className="min-h-12 w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-[15px] text-stone-100 outline-none placeholder:text-stone-500 focus:border-[#4e6bd8]"
                      />
                      <p className="text-xs leading-6 text-stone-500">只保存在当前浏览器，不会写进服务端环境变量。</p>
                    </label>
                  ) : null}

                  <div className="space-y-3 rounded-[24px] border border-white/8 bg-white/[0.02] p-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-stone-500">接管已有会话</p>
                      <p className="mt-2 text-sm leading-7 text-stone-400">
                        {selectedProviderMeta.accessMode === "public_address"
                          ? "输入已有邮箱地址后，直接在当前浏览器继续查看收件箱。"
                          : selectedProviderMeta.accessMode === "api_key"
                            ? "输入已有邮箱地址，并结合你自己的 API key，在当前浏览器继续查看收件箱。"
                            : "输入已有邮箱地址和 token，把这个会话接管到当前浏览器。"}
                      </p>
                    </div>
                    <label className="block space-y-2">
                      <span className="text-xs text-stone-500">已有邮箱地址</span>
                      <input
                        value={importAddressInput}
                        onChange={(event) => setImportAddressInput(event.target.value.trim())}
                        placeholder="例如 hello@example.com"
                        className="min-h-12 w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-[15px] text-stone-100 outline-none placeholder:text-stone-500 focus:border-[#4e6bd8]"
                      />
                    </label>
                    {selectedProviderMeta.accessMode === "account_token" || selectedProviderMeta.accessMode === "inbox_token" ? (
                      <label className="block space-y-2">
                        <span className="text-xs text-stone-500">访问 token</span>
                        <input
                          value={importTokenInput}
                          onChange={(event) => setImportTokenInput(event.target.value.trim())}
                          placeholder={selectedProviderMeta.accessMode === "inbox_token" ? "粘贴 inbox token" : "粘贴账号 token"}
                          className="min-h-12 w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-[15px] text-stone-100 outline-none placeholder:text-stone-500 focus:border-[#4e6bd8]"
                        />
                      </label>
                    ) : null}
                    <button
                      type="button"
                      onClick={importMailboxSession}
                      disabled={!canImportSession}
                      className="min-h-11 w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-sm font-medium text-stone-200 transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:text-stone-600"
                    >
                      接管这个邮箱
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => createMailboxSession(selectedProvider)}
                      disabled={busy || !selectedProviderMeta.enabled || (selectedProviderMeta.accessMode === "api_key" && !selectedProviderApiKey)}
                      className="min-h-12 flex-1 rounded-2xl bg-[#1d1f47] px-4 text-sm font-semibold text-[#7cc0ff] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {busy ? "创建中..." : mailbox ? "重建地址" : "创建临时邮箱"}
                    </button>
                    <button
                      type="button"
                      onClick={createRandomMailbox}
                      disabled={busy || !selectedProviderMeta.enabled || (selectedProviderMeta.accessMode === "api_key" && !selectedProviderApiKey)}
                      aria-label="随机生成邮箱"
                      className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03] text-stone-300 transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <ShuffleIcon />
                    </button>
                  </div>
                </div>

                <div className="space-y-2 border-t border-white/8 pt-4">
                  <p className="text-sm font-medium text-stone-200">当前聚合源：{selectedProviderMeta.name}</p>
                  <p className="text-sm leading-7 text-stone-400">{selectedProviderMeta.limitations[0] ?? selectedProviderMeta.description}</p>
                  <a
                    href={selectedProviderMeta.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-stone-300 transition hover:text-white"
                  >
                    {selectedProviderMeta.accessMode === "api_key" ? "申请 API key / 查看文档" : "查看文档"}
                    <ExternalIcon />
                  </a>
                </div>

                {recentMailboxes.length > 0 ? (
                  <div className="space-y-3 border-t border-white/8 pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-stone-200">最近邮箱</p>
                      <span className="text-xs text-stone-500">保存在本地浏览器</span>
                    </div>
                    <div className="space-y-2">
                      {recentMailboxes.map((item) => {
                        const activeMailbox = mailbox ? getMailboxIdentity(mailbox) === getMailboxIdentity(item) : false;

                        return (
                          <div key={getMailboxIdentity(item)} className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                activateMailbox(
                                  item,
                                  `已从最近邮箱列表切换到 ${getMailboxDisplayAddress(item)}。`
                                )
                              }
                              className={`min-h-11 flex-1 rounded-2xl border px-3 text-left text-sm transition ${
                                activeMailbox
                                  ? "border-transparent bg-[#1d1f47] text-[#9bd0ff]"
                                  : "border-white/8 bg-white/[0.02] text-stone-300 hover:bg-white/[0.04]"
                              }`}
                            >
                              <span className="block truncate font-mono text-[13px]">{getMailboxDisplayAddress(item)}</span>
                              <span className="mt-1 block text-[11px] text-stone-500">{item.providerLabel}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => removeMailboxFromHistory(item)}
                              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.02] text-xs text-stone-400 transition hover:bg-white/[0.04] hover:text-white"
                            >
                              删除
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </aside>

        <section className="flex min-h-dvh flex-1 flex-col">
          <header className="border-b border-white/10 px-5 py-4 sm:px-8">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-stone-100 xl:max-w-[420px]">
                  <span className="text-stone-400">
                    <InboxIcon className="h-4.5 w-4.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[15px]">
                      {mailbox ? getMailboxDisplayAddress(mailbox) : `${selectedProviderMeta.name} · 尚未创建邮箱`}
                  </span>
                  <button
                    type="button"
                    onClick={copyAddress}
                    disabled={!mailbox}
                    aria-label="复制邮箱地址"
                    className="text-stone-400 transition hover:text-white disabled:cursor-not-allowed disabled:text-stone-600"
                  >
                    <CopyIcon />
                  </button>
                </div>

                <div className="hidden xl:flex xl:items-center xl:gap-2">
                  <Pill>{formatAccessMode(mailbox?.accessMode ?? selectedProviderMeta.accessMode)}</Pill>
                  <Pill>{mailbox ? formatRelativeExpiry(mailbox.expiresAt) : "等待创建"}</Pill>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => refreshMessages()}
                  disabled={!mailbox || loadingMessages}
                  aria-label="刷新收件箱"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03] text-stone-200 transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:text-stone-600"
                >
                  <RefreshIcon className="h-4.5 w-4.5" />
                </button>
                <Pill>{loadingMessages ? "同步中" : "15 秒自动检查"}</Pill>
              </div>
            </div>
            <p className="mt-3 text-sm leading-7 text-stone-400">{notice}</p>
          </header>

          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {mailbox && messages.length > 0 ? (
              <div className="grid min-h-0 flex-1 lg:grid-cols-[360px_minmax(0,1fr)]">
                <section className="min-h-0 border-b border-white/10 px-5 py-6 lg:border-b-0 lg:border-r lg:px-6">
                  <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                      <h1 className="text-[44px] font-semibold tracking-tight text-stone-100">收件箱</h1>
                      <p className="mt-3 text-sm leading-7 text-stone-400">来自 {selectedProviderMeta.name} 的邮件会持续出现在这里。</p>
                    </div>
                    <span className="text-sm text-stone-500">{messages.length} 封</span>
                  </div>

                  <div className="min-h-0 space-y-3 overflow-y-auto pr-1 lg:h-[calc(100dvh-220px)]">
                    {messages.map((message) => {
                      const active = activeMessage?.id === message.id;
                      const isLoading = loadingMessageId === message.id;

                      return (
                        <button
                          key={message.id}
                          type="button"
                          onClick={() => openMessage(message.id)}
                          className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                            active
                              ? "border-transparent bg-[#1d1f47]"
                              : "border-transparent bg-transparent hover:bg-white/[0.03]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className={`truncate text-[15px] font-medium ${active ? "text-[#8cc8ff]" : "text-stone-100"}`}>
                                {message.subject}
                              </p>
                              <p className="mt-2 truncate text-sm text-stone-400">{isLoading ? "正在载入邮件..." : message.from}</p>
                            </div>
                            <span className="shrink-0 text-xs text-stone-500">
                              {message.receivedAt
                                ? new Date(message.receivedAt).toLocaleTimeString("zh-CN", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : "--:--"}
                            </span>
                          </div>
                          {message.snippet ? <p className="mt-3 line-clamp-2 text-sm leading-7 text-stone-400">{message.snippet}</p> : null}
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="min-h-0 px-5 py-6 lg:px-8">
                  {activeMessage ? (
                    <div className="h-full w-full overflow-y-auto pr-1">
                      <div className="w-full space-y-8">
                        <div>
                          <h2 className="text-3xl font-semibold tracking-tight text-stone-100">{activeMessage.subject}</h2>
                          <div className="mt-5 grid gap-2 text-sm leading-7 text-stone-400">
                            <p><span className="text-stone-500">发件人：</span>{activeMessage.from}</p>
                            {activeMessage.to ? <p><span className="text-stone-500">收件人：</span>{activeMessage.to}</p> : null}
                            <p><span className="text-stone-500">时间：</span>{activeMessage.receivedAt ? new Date(activeMessage.receivedAt).toLocaleString("zh-CN") : "未知"}</p>
                          </div>
                        </div>

                        {activeMessage.attachments.length > 0 ? (
                          <div className="space-y-3 border-t border-white/10 pt-6">
                            <p className="text-sm font-medium text-stone-200">附件</p>
                            <div className="flex flex-wrap gap-2.5">
                              {activeMessage.attachments.map((attachment) =>
                                attachment.downloadMode === "unsupported" ? (
                                  <span
                                    key={attachment.id}
                                    className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 text-xs text-stone-500"
                                  >
                                    <PaperclipIcon />
                                    {attachment.filename}（暂不支持）
                                  </span>
                                ) : (
                                  <button
                                    key={attachment.id}
                                    type="button"
                                    onClick={() => downloadAttachment(activeMessage.id, attachment.id)}
                                    className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#31356a] bg-[#1d1f47] px-4 text-xs text-[#8cc8ff] transition hover:brightness-110"
                                  >
                                    <PaperclipIcon />
                                    {downloadingAttachmentId === attachment.id ? `下载中 ${attachment.filename}` : `下载 ${attachment.filename}`}
                                  </button>
                                )
                              )}
                            </div>
                          </div>
                        ) : null}

                        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                          <article className="rounded-3xl border border-white/8 bg-white/[0.03] p-5">
                            <div className="mb-4 flex items-center justify-between gap-3">
                              <p className="text-sm font-medium text-stone-200">纯文本</p>
                              <span className="text-xs text-stone-500">稳定阅读</span>
                            </div>
                            <div className="max-h-[480px] overflow-y-auto whitespace-pre-wrap text-sm leading-8 text-stone-300">
                              {activeMessage.text ?? "无纯文本正文。"}
                            </div>
                          </article>

                          <article className="rounded-3xl border border-white/8 bg-white/[0.03] p-5">
                            <div className="mb-4 flex items-center justify-between gap-3">
                              <p className="text-sm font-medium text-stone-200">HTML 预览</p>
                              <span className="text-xs text-stone-500">沙箱隔离</span>
                            </div>
                            <div className="max-h-[480px] overflow-auto rounded-[22px] border border-stone-300/60 bg-white p-3">
                              {activeMessage.html ? (
                                <iframe
                                  title="邮件 HTML 预览"
                                  srcDoc={activeMessage.html}
                                  sandbox=""
                                  referrerPolicy="no-referrer"
                                  className="min-h-[360px] w-full rounded-2xl border-0 bg-white"
                                />
                              ) : (
                                <div className="flex min-h-[260px] items-center justify-center rounded-2xl bg-stone-50 px-6 text-center text-sm leading-7 text-stone-500">
                                  这封邮件没有提供 HTML 正文，当前只展示纯文本内容。
                                </div>
                              )}
                            </div>
                          </article>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <EmptyState
                      title="选择一封邮件"
                      description="左侧收件箱已经收到邮件，点击其中任意一封后，正文、附件和 HTML 预览会显示在这里。"
                    />
                  )}
                </section>
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col px-5 py-6 sm:px-8">
                <div>
                  <h1 className="text-[44px] font-semibold tracking-tight text-stone-100">收件箱</h1>
                </div>
                {!mailbox ? (
                  <EmptyState
                    title="先创建一个临时邮箱"
                    description="左侧选择聚合源并填写地址参数后，就能开始收信。整个界面保留 DuckMail 式的简洁结构，但把我们的多源聚合能力整合进了侧栏。"
                    action={
                      <button
                        type="button"
                        onClick={() => createMailboxSession(selectedProvider)}
                        disabled={busy || !selectedProviderMeta.enabled || (selectedProviderMeta.accessMode === "api_key" && !selectedProviderApiKey)}
                        className="min-h-12 rounded-2xl bg-[#1d1f47] px-6 text-sm font-semibold text-[#8cc8ff] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {busy ? "创建中..." : `创建 ${selectedProviderMeta.name} 邮箱`}
                      </button>
                    }
                  />
                ) : (
                  <EmptyState
                    title="收件箱为空"
                    description="您还没有收到任何邮件。当收到邮件后，它们会先出现在当前画布左侧的列表中，保持页面打开即可继续自动轮询。"
                    action={
                      <button
                        type="button"
                        onClick={() => refreshMessages()}
                        disabled={loadingMessages}
                        className="min-h-12 rounded-2xl border border-white/8 bg-white/[0.03] px-6 text-sm font-semibold text-stone-200 transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:text-stone-600"
                      >
                        {loadingMessages ? "刷新中..." : "立即刷新"}
                      </button>
                    }
                  />
                )}
              </div>
            )}
          </main>
        </section>
      </div>
    </div>
  );
}
