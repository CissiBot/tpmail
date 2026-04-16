"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { randomLocalPart } from "@/lib/tpmail/utils";

const MAILBOX_STORAGE_KEY = "tpmail:last-mailbox";
const MAILBOX_HISTORY_STORAGE_KEY = "tpmail:mailbox-history";
const PROVIDER_STORAGE_KEY = "tpmail:selected-provider";
const PROVIDER_CREDENTIALS_STORAGE_KEY = "tpmail:provider-credentials";
const MAX_RECENT_MAILBOXES = 8;
const AUTO_REFRESH_INTERVAL_MS = 10000;

type ErrorLike = {
  error?: {
    message?: string;
  };
};

type ProviderApiKeyState = Partial<Record<ProviderId, string>>;

type RequestTracker = {
  requestId: number;
  controller: AbortController | null;
};

type MailboxScopedRequestTracker = RequestTracker & {
  mailboxScope: number;
  mailboxIdentity: string | null;
};

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

function ChevronDownIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function PanelIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9 4v16" />
    </svg>
  );
}

function CloseIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
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

function getProviderPreviewCopy(provider: ProviderDescriptor) {
  return provider.limitations[0] ?? provider.description;
}

function ProviderSelectionCard({
  provider,
  actualSelected,
  onClick,
  onMouseEnter,
  onFocus,
  onBlur,
}: {
  provider: ProviderDescriptor;
  actualSelected: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const activeClasses = actualSelected
    ? provider.enabled
      ? "border-[#000000] bg-[#24212e] text-stone-50 shadow-[2px_2px_0_0_#000000]"
      : "border-[#57534e] bg-[#232325] text-stone-200 shadow-[2px_2px_0_0_#3f3f46]"
    : provider.enabled
      ? "border-transparent bg-transparent text-stone-200 hover:bg-white/[0.02]"
      : "border-transparent bg-transparent text-stone-400 hover:bg-white/[0.01]";
  const scaleClasses = actualSelected ? "xl:scale-[1.02]" : "xl:scale-100";
  const dotClasses = provider.enabled ? "bg-emerald-300" : "bg-stone-500";
  const labelClasses = provider.enabled ? (actualSelected ? "text-stone-50" : "text-stone-200") : "text-stone-400";

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onFocus={onFocus}
      onBlur={onBlur}
      disabled={!provider.enabled}
      role="radio"
      aria-checked={actualSelected}
      className={`group flex w-full origin-left items-center gap-2 rounded-[13px] border px-2.5 py-1.5 text-left transition duration-200 ${activeClasses} ${scaleClasses} disabled:cursor-not-allowed`}
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex shrink-0 items-center justify-center rounded-full border-[3px] border-black shadow-[2px_2px_0_0_#000000] transition-all ${
          actualSelected ? "h-5 w-5 bg-[#ff90e8]" : provider.enabled ? "h-4 w-4 bg-white" : "h-4 w-4 border-stone-500 bg-[#d6d3d1]"
        }`}
      >
        {actualSelected ? <span className="h-1.5 w-1.5 rounded-full bg-black" /> : null}
      </span>
      <span className={`truncate font-extrabold tracking-tight ${actualSelected ? "text-[12px]" : "text-[11px]"} ${labelClasses}`}>{provider.name}</span>
      <span className="ml-auto inline-flex items-center gap-1.5 pl-2 text-[9px] font-medium text-stone-500" aria-hidden="true">
        <span className={`inline-flex h-1.5 w-1.5 rounded-full ${dotClasses}`} />
        {!provider.enabled ? "关闭" : actualSelected ? "当前" : "可用"}
      </span>
      {actualSelected ? <span className="sr-only">当前已选中</span> : null}
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

function AnimatedRefreshFill({
  active,
  cycleKey,
}: {
  active: boolean;
  cycleKey: number | string;
}) {
  const animationName = typeof cycleKey === "number" && cycleKey % 2 === 0 ? "mailbox-refresh-fill-a" : "mailbox-refresh-fill-b";

  return (
    <div
      className={`mailbox-refresh-fill-layer ${active ? animationName : ""}`.trim()}
      aria-hidden="true"
    />
  );
}

function ProviderPreviewCard({
  provider,
  selected,
  interactive = true,
  arrow = false,
}: {
  provider: ProviderDescriptor;
  selected: boolean;
  interactive?: boolean;
  arrow?: boolean;
}) {
  return (
    <div className="relative">
      <div className="absolute inset-3 rounded-[24px] bg-[linear-gradient(135deg,rgba(99,102,241,0.16),rgba(168,85,247,0.14))] blur-2xl" aria-hidden="true" />
      {arrow ? (
        <div
          className="absolute left-[-6px] top-16 h-3 w-3 rotate-45 border border-white/10 bg-[linear-gradient(135deg,rgba(17,24,39,0.96),rgba(31,41,55,0.96))]"
          aria-hidden="true"
        />
      ) : null}
      <div
        className={`relative overflow-hidden rounded-[24px] border border-white/10 bg-[linear-gradient(135deg,rgba(17,24,39,0.96),rgba(31,41,55,0.96))] p-4 text-left shadow-[0_18px_40px_rgba(0,0,0,0.34)] ${
          interactive ? "pointer-events-auto" : "pointer-events-none"}
        `}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-300">
            <InboxIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-white">{provider.name}</p>
              <span className={`inline-flex min-h-6 items-center rounded-full border px-2 text-[11px] font-medium ${getTierBadge(provider)}`}>
                {provider.tier}
              </span>
              <span className={`inline-flex min-h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-medium ${getAvailabilityBadge(provider)}`}>
                <DotIcon />
                {provider.enabled ? "可用" : "关闭"}
              </span>
            </div>
            <p className="mt-1 text-xs text-indigo-200">{selected ? "当前主选择" : `${formatAccessMode(provider.accessMode)} 预览`}</p>
          </div>
        </div>

        <p className="mt-4 text-sm leading-6 text-slate-300">{getProviderPreviewCopy(provider)}</p>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1">
            <DotIcon className="h-2 w-2 text-[#ff90e8]" />
            {provider.requiresSecret ? "需要凭证" : "公共可用"}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1">
            <DotIcon className="h-2 w-2 text-sky-300" />
            {formatAccessMode(provider.accessMode)}
          </span>
        </div>

        <a
          href={provider.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-2 text-sm text-slate-200 transition hover:text-white"
        >
          {provider.accessMode === "api_key" ? "申请 API key / 查看文档" : "查看文档"}
          <ExternalIcon className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

function ParameterField({
  label,
  disabled = false,
  helper,
  action,
  children,
}: {
  label: string;
  disabled?: boolean;
  helper?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className={`block space-y-1 ${disabled ? "opacity-60" : ""}`}>
      <span className="flex items-center justify-between gap-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-stone-500">
        <span>{label}</span>
        {action}
      </span>
      <div
        className={`rounded-[16px] border-2 bg-[#1f2024] px-2.5 py-1.5 shadow-[2px_2px_0_0_#000000] transition ${
          disabled ? "border-[#4b5563] bg-[#232427]" : "border-[#0f1011]"
        }`}
      >
        {children}
      </div>
      {helper ? <div className="px-1 text-[9px] leading-4 text-stone-500">{helper}</div> : null}
    </label>
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
  const [domainOptions, setDomainOptions] = useState<ProviderDomainOption[]>([]);
  const [selectedDomain, setSelectedDomain] = useState("");
  const [providerApiKeys, setProviderApiKeys] = useState<ProviderApiKeyState>({});
  const [recentMailboxes, setRecentMailboxes] = useState<MailboxSession[]>([]);
  const [hoveredProviderId, setHoveredProviderId] = useState<ProviderId | null>(null);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [historySort, setHistorySort] = useState<"recent" | "address" | "provider">("recent");
  const [clientReady, setClientReady] = useState(false);
  const [refreshSequence, setRefreshSequence] = useState(0);
  const [refreshCycleStartedAt, setRefreshCycleStartedAt] = useState<number | null>(null);
  const [refreshClock, setRefreshClock] = useState(0);
  const mailboxRef = useRef<MailboxSession | null>(null);
  const mailboxScopeRef = useRef(0);
  const sessionRequestRef = useRef<RequestTracker>({ requestId: 0, controller: null });
  const refreshRequestRef = useRef<MailboxScopedRequestTracker>({ requestId: 0, controller: null, mailboxScope: 0, mailboxIdentity: null });
  const openMessageRequestRef = useRef<MailboxScopedRequestTracker>({ requestId: 0, controller: null, mailboxScope: 0, mailboxIdentity: null });
  const attachmentRequestRef = useRef<MailboxScopedRequestTracker>({ requestId: 0, controller: null, mailboxScope: 0, mailboxIdentity: null });
  const historyMenuRef = useRef<HTMLDivElement | null>(null);
  const historyPanelRef = useRef<HTMLDivElement | null>(null);

  const selectedProviderMeta = useMemo(
    () => providers.find((provider) => provider.id === selectedProvider) ?? providers[0],
    [providers, selectedProvider]
  );

  const enabledProviders = useMemo(() => providers.filter((provider) => provider.enabled), [providers]);
  const providerOptions = useMemo(() => providers, [providers]);
  const previewProviderMeta = useMemo(
    () => (hoveredProviderId ? providers.find((provider) => provider.id === hoveredProviderId) ?? null : null),
    [hoveredProviderId, providers]
  );
  const renderMailbox = clientReady ? mailbox : null;
  const renderMessages = clientReady ? messages : [];
  const renderActiveMessage = clientReady ? activeMessage : null;
  const renderRecentMailboxes = clientReady ? recentMailboxes : [];
  const refreshSecondsRemaining = useMemo(() => {
    if (!renderMailbox || refreshCycleStartedAt === null) {
      return AUTO_REFRESH_INTERVAL_MS / 1000;
    }

    return Math.max(0, Math.ceil((AUTO_REFRESH_INTERVAL_MS - (refreshClock - refreshCycleStartedAt)) / 1000));
  }, [renderMailbox, refreshClock, refreshCycleStartedAt]);
  const sortedRecentMailboxes = useMemo(() => {
    const items = [...recentMailboxes];
    if (historySort === "address") {
      return items.sort((left, right) => getMailboxDisplayAddress(left).localeCompare(getMailboxDisplayAddress(right), "zh-CN"));
    }

    if (historySort === "provider") {
      return items.sort((left, right) => {
        const providerOrder = left.providerLabel.localeCompare(right.providerLabel, "zh-CN");
        if (providerOrder !== 0) {
          return providerOrder;
        }

        return getMailboxDisplayAddress(left).localeCompare(getMailboxDisplayAddress(right), "zh-CN");
      });
    }

    return items;
  }, [historySort, recentMailboxes]);
  const renderSortedRecentMailboxes = clientReady ? sortedRecentMailboxes : [];

  const selectedProviderApiKey = providerApiKeys[selectedProvider]?.trim() ?? "";
  const credentialFieldMeta = useMemo(() => {
    switch (selectedProviderMeta.accessMode) {
      case "api_key":
        return {
          label: "API key",
          placeholder: "粘贴创建所需的 API key",
          editable: true,
          helper: "仅保存在当前浏览器。",
        };
      case "account_token":
        return {
          label: "账号 token",
          placeholder: "创建后自动生成，无需手填",
          editable: false,
          helper: undefined,
        };
      case "inbox_token":
        return {
          label: "邮箱 token",
          placeholder: "创建后自动生成，无需手填",
          editable: false,
          helper: undefined,
        };
      default:
        return {
          label: "额外凭证",
          placeholder: "当前聚合源无需额外凭证",
          editable: false,
          helper: undefined,
        };
    }
  }, [selectedProviderMeta.accessMode]);
  const credentialDocsLink = selectedProviderMeta.requiresSecret ? selectedProviderMeta.docsUrl : null;

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

  const abortRequestTracker = useCallback((tracker: RequestTracker | MailboxScopedRequestTracker) => {
    tracker.controller?.abort();
    tracker.controller = null;
  }, []);

  const beginSessionRequest = useCallback(() => {
    abortRequestTracker(sessionRequestRef.current);
    sessionRequestRef.current.requestId += 1;
    sessionRequestRef.current.controller = new AbortController();

    return {
      requestId: sessionRequestRef.current.requestId,
      controller: sessionRequestRef.current.controller,
    };
  }, [abortRequestTracker]);

  const isCurrentSessionRequest = useCallback((requestId: number) => sessionRequestRef.current.requestId === requestId, []);

  const invalidateSessionRequest = useCallback(
    (options?: { clearBusy?: boolean }) => {
      abortRequestTracker(sessionRequestRef.current);
      sessionRequestRef.current.requestId += 1;

      if (options?.clearBusy ?? true) {
        setBusy(false);
      }
    },
    [abortRequestTracker]
  );

  const beginMailboxScopedRequest = useCallback(
    (tracker: { current: MailboxScopedRequestTracker }, targetMailbox: MailboxSession) => {
      abortRequestTracker(tracker.current);
      tracker.current.requestId += 1;
      tracker.current.mailboxScope = mailboxScopeRef.current;
      tracker.current.mailboxIdentity = getMailboxIdentity(targetMailbox);
      tracker.current.controller = new AbortController();

      return {
        requestId: tracker.current.requestId,
        mailboxScope: tracker.current.mailboxScope,
        mailboxIdentity: tracker.current.mailboxIdentity,
        controller: tracker.current.controller,
      };
    },
    [abortRequestTracker]
  );

  const isCurrentMailboxScopedRequest = useCallback(
    (tracker: { current: MailboxScopedRequestTracker }, requestId: number, mailboxScope: number, mailboxIdentity: string) => {
      const currentMailboxIdentity = mailboxRef.current ? getMailboxIdentity(mailboxRef.current) : null;

      return (
        tracker.current.requestId === requestId &&
        tracker.current.mailboxScope === mailboxScope &&
        tracker.current.mailboxIdentity === mailboxIdentity &&
        currentMailboxIdentity === mailboxIdentity &&
        mailboxScopeRef.current === mailboxScope
      );
    },
    []
  );

  const invalidateMailboxScopedRequests = useCallback(() => {
    mailboxScopeRef.current += 1;
    abortRequestTracker(refreshRequestRef.current);
    abortRequestTracker(openMessageRequestRef.current);
    abortRequestTracker(attachmentRequestRef.current);
    setLoadingMessages(false);
    setLoadingMessageId(null);
    setDownloadingAttachmentId(null);
  }, [abortRequestTracker]);

  const clearStoredMailbox = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.removeItem(MAILBOX_STORAGE_KEY);
  }, []);

  const activateMailbox = useCallback(
    (nextMailbox: MailboxSession, nextNotice?: string) => {
      invalidateSessionRequest();
      invalidateMailboxScopedRequests();
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
    [invalidateMailboxScopedRequests, invalidateSessionRequest]
  );

  function resetWorkspace(nextProvider: ProviderDescriptor) {
    invalidateSessionRequest();
    invalidateMailboxScopedRequests();
    setSelectedProvider(nextProvider.id);
      setMailbox(null);
      setMessages([]);
      setActiveMessage(null);
      setDownloadingAttachmentId(null);
      setSelectedDomain("");
      clearStoredMailbox();
      setNotice(
        nextProvider.enabled
        ? `已切换到 ${nextProvider.name}，现在可以创建新的临时邮箱。`
        : `${nextProvider.name} 当前未启用，暂时不能创建会话。`
    );
  }

  function handleProviderSelection(nextProvider: ProviderDescriptor) {
    if (nextProvider.id === selectedProvider) {
      setNotice(`${nextProvider.name} 已经是当前聚合源，你可以直接继续创建邮箱。`);
      return;
    }

    resetWorkspace(nextProvider);
  }

  function deleteHistoryEntries(targets: MailboxSession[]) {
    if (targets.length === 0) {
      return;
    }

    const targetIds = new Set(targets.map((item) => getMailboxIdentity(item)));

    setRecentMailboxes((current) => current.filter((item) => !targetIds.has(getMailboxIdentity(item))));
    setSelectedHistoryIds((current) => current.filter((id) => !targetIds.has(id)));

    if (mailbox && targetIds.has(getMailboxIdentity(mailbox))) {
      invalidateSessionRequest();
      invalidateMailboxScopedRequests();
      setMailbox(null);
      setMessages([]);
      setActiveMessage(null);
      setDownloadingAttachmentId(null);
      clearStoredMailbox();
      setNotice(targets.length > 1 ? "已删除选中的缓存记录，当前会话已被清除。" : "已从缓存记录中移除当前会话。 ");
      return;
    }

    setNotice(targets.length > 1 ? `已删除 ${targets.length} 条缓存记录。` : "已删除 1 条缓存记录。");
  }

  function removeMailboxFromHistory(targetMailbox: MailboxSession) {
    deleteHistoryEntries([targetMailbox]);
  }

  function toggleHistorySelection(targetId: string) {
    setSelectedHistoryIds((current) => (current.includes(targetId) ? current.filter((id) => id !== targetId) : [...current, targetId]));
  }

  function toggleAllHistorySelection(checked: boolean) {
    setSelectedHistoryIds(checked ? renderSortedRecentMailboxes.map((item) => getMailboxIdentity(item)) : []);
  }

  async function createMailboxSession(provider: ProviderId, overrides?: { alias?: string; domain?: string }) {
    const nextAlias = overrides?.alias ?? (aliasInput.trim() || undefined);
    const nextDomain = overrides?.domain ?? (selectedDomain || undefined);
    const apiKey = providerApiKeys[provider]?.trim() || undefined;
    const { requestId, controller } = beginSessionRequest();

    setBusy(true);
    setNotice("正在创建邮箱地址...");

    try {
      const response = await fetch("/api/mailboxes", {
        method: "POST",
        signal: controller.signal,
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

      if (!isCurrentSessionRequest(requestId)) {
        return;
      }

      activateMailbox(
        data.mailbox,
        isBrowserManagedMailboxSession(data.mailbox)
          ? `已创建 ${data.mailbox.providerLabel} 邮箱，当前会话已保存在这个浏览器中。`
          : `已创建 ${data.mailbox.providerLabel} 邮箱，系统正在同步最新收件箱。`
      );
    } catch (error) {
      if (controller.signal.aborted || !isCurrentSessionRequest(requestId)) {
        return;
      }

      setNotice(error instanceof Error ? error.message : "创建邮箱失败");
    } finally {
      if (isCurrentSessionRequest(requestId)) {
        setBusy(false);
      }
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

      const mailboxIdentity = getMailboxIdentity(targetMailbox);
      const { requestId, mailboxScope, controller } = beginMailboxScopedRequest(refreshRequestRef, targetMailbox);

      setLoadingMessages(true);
      try {
        const response = await fetch(`/api/mailboxes/${targetMailbox.id}/messages`, {
          cache: "no-store",
          signal: controller.signal,
          headers: buildMailboxRequestHeaders(targetMailbox),
        });
        const data = (await response.json()) as { messages?: MessageSummary[] } & ErrorLike;

        if (!isCurrentMailboxScopedRequest(refreshRequestRef, requestId, mailboxScope, mailboxIdentity)) {
          return;
        }

        if (!response.ok || !data.messages) {
          const shouldDiscardMailbox =
            response.status === 404 ||
            response.status === 410 ||
            (isBrowserManagedMailboxSession(targetMailbox) && (response.status === 400 || response.status === 401));

          if (shouldDiscardMailbox) {
            clearStoredMailbox();
            setRecentMailboxes((current) => removeRecentMailbox(current, targetMailbox));
            invalidateMailboxScopedRequests();
            setMailbox((current) => (current && getMailboxIdentity(current) === mailboxIdentity ? null : current));
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
        if (controller.signal.aborted || !isCurrentMailboxScopedRequest(refreshRequestRef, requestId, mailboxScope, mailboxIdentity)) {
          return;
        }

        setNotice(error instanceof Error ? error.message : "收件箱拉取失败");
      } finally {
        if (isCurrentMailboxScopedRequest(refreshRequestRef, requestId, mailboxScope, mailboxIdentity)) {
          setLoadingMessages(false);
        }
      }
    },
    [beginMailboxScopedRequest, buildMailboxRequestHeaders, clearStoredMailbox, invalidateMailboxScopedRequests, isCurrentMailboxScopedRequest, mailbox]
  );

  const triggerRefresh = useCallback(
    async (currentMailbox?: MailboxSession | null) => {
      setRefreshCycleStartedAt(null);
      setRefreshClock(Date.now());
      await refreshMessages(currentMailbox);
      setRefreshCycleStartedAt(Date.now());
      setRefreshClock(Date.now());
    },
    [refreshMessages]
  );

  async function openMessage(messageId: string) {
    if (!mailbox) {
      return;
    }

    const targetMailbox = mailbox;
    const mailboxIdentity = getMailboxIdentity(targetMailbox);
    const { requestId, mailboxScope, controller } = beginMailboxScopedRequest(openMessageRequestRef, targetMailbox);

    setLoadingMessageId(messageId);
    try {
      const response = await fetch(`/api/mailboxes/${targetMailbox.id}/messages/${messageId}`, {
        cache: "no-store",
        signal: controller.signal,
        headers: buildMailboxRequestHeaders(targetMailbox),
      });
      const data = (await response.json()) as { message?: MessageDetail } & ErrorLike;

      if (!isCurrentMailboxScopedRequest(openMessageRequestRef, requestId, mailboxScope, mailboxIdentity)) {
        return;
      }

      if (!response.ok || !data.message) {
        throw new Error(data.error?.message ?? "邮件读取失败");
      }

      setActiveMessage(data.message);
      setNotice("邮件详情已更新，HTML 内容会在隔离容器中显示。 ");
    } catch (error) {
      if (controller.signal.aborted || !isCurrentMailboxScopedRequest(openMessageRequestRef, requestId, mailboxScope, mailboxIdentity)) {
        return;
      }

      setNotice(error instanceof Error ? error.message : "邮件读取失败");
    } finally {
      if (isCurrentMailboxScopedRequest(openMessageRequestRef, requestId, mailboxScope, mailboxIdentity)) {
        setLoadingMessageId(null);
      }
    }
  }

  async function downloadAttachment(messageId: string, attachmentId: string) {
    if (!mailbox) {
      return;
    }

    const targetMailbox = mailbox;
    const mailboxIdentity = getMailboxIdentity(targetMailbox);
    const { requestId, mailboxScope, controller } = beginMailboxScopedRequest(attachmentRequestRef, targetMailbox);

    setDownloadingAttachmentId(attachmentId);
    try {
      const response = await fetch(`/api/mailboxes/${targetMailbox.id}/messages/${messageId}/attachments/${attachmentId}`, {
        cache: "no-store",
        signal: controller.signal,
        headers: {
          ...buildMailboxRequestHeaders(targetMailbox),
          "x-tpmail-download-mode": "json",
        },
      });

      const data = (await response.json()) as { url?: string } & ErrorLike;
      if (!isCurrentMailboxScopedRequest(attachmentRequestRef, requestId, mailboxScope, mailboxIdentity)) {
        return;
      }

      if (!response.ok || !data.url) {
        throw new Error(data.error?.message ?? "附件下载失败");
      }

      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      if (controller.signal.aborted || !isCurrentMailboxScopedRequest(attachmentRequestRef, requestId, mailboxScope, mailboxIdentity)) {
        return;
      }

      setNotice(error instanceof Error ? error.message : "附件下载失败");
    } finally {
      if (isCurrentMailboxScopedRequest(attachmentRequestRef, requestId, mailboxScope, mailboxIdentity)) {
        setDownloadingAttachmentId(null);
      }
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
    mailboxRef.current = mailbox;
  }, [mailbox]);

  useEffect(() => {
    setClientReady(true);
  }, []);

  useEffect(() => {
    setSelectedHistoryIds((current) => current.filter((id) => recentMailboxes.some((item) => getMailboxIdentity(item) === id)));
  }, [recentMailboxes]);

  useEffect(() => {
    if (!mailbox) {
      setRefreshCycleStartedAt(null);
      return;
    }

    const timer = window.setInterval(() => {
      setRefreshClock(Date.now());
    }, 200);

    return () => {
      window.clearInterval(timer);
    };
  }, [mailbox]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (historyMenuRef.current && !historyMenuRef.current.contains(target)) {
        setHistoryMenuOpen(false);
      }

    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!clientReady) {
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
  }, [activateMailbox, clientReady, providers]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!clientReady) {
      return;
    }

    window.localStorage.setItem(PROVIDER_STORAGE_KEY, selectedProvider);
  }, [clientReady, selectedProvider]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!clientReady) {
      return;
    }

    const nextEntries = Object.entries(providerApiKeys).filter((entry) => entry[1]?.trim());
    if (nextEntries.length === 0) {
      window.localStorage.removeItem(PROVIDER_CREDENTIALS_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(PROVIDER_CREDENTIALS_STORAGE_KEY, JSON.stringify(Object.fromEntries(nextEntries)));
  }, [clientReady, providerApiKeys]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!clientReady) {
      return;
    }

    if (recentMailboxes.length === 0) {
      window.localStorage.removeItem(MAILBOX_HISTORY_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(MAILBOX_HISTORY_STORAGE_KEY, JSON.stringify(recentMailboxes));
  }, [clientReady, recentMailboxes]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!clientReady) {
      return;
    }

    if (!mailbox) {
      window.localStorage.removeItem(MAILBOX_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(MAILBOX_STORAGE_KEY, buildMailboxSnapshotValue(mailbox));
    setRecentMailboxes((current) => upsertRecentMailboxes(current, mailbox));
  }, [buildMailboxSnapshotValue, clientReady, mailbox]);

  useEffect(() => {
    if (!clientReady || !mailbox) {
      invalidateMailboxScopedRequests();
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    async function cycle() {
      await triggerRefresh(mailbox);
      if (cancelled) {
        return;
      }

      timer = window.setTimeout(() => {
        void cycle();
      }, AUTO_REFRESH_INTERVAL_MS);
    }

    void cycle();

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
      invalidateMailboxScopedRequests();
    };
  }, [clientReady, invalidateMailboxScopedRequests, mailbox, refreshSequence, triggerRefresh]);

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
        <aside className="relative w-full shrink-0 border-b border-white/10 bg-[#191b1c] lg:h-dvh lg:w-[360px] lg:border-b-0 lg:border-r lg:overflow-visible">
          <div className="flex h-full min-h-0 flex-col px-5 pb-5 pt-5">
            <div className="shrink-0">
              <div className="inline-flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#27292b] text-[#f5c95f]">
                  <InboxIcon className="h-4.5 w-4.5" />
                </div>
                <div>
                  <p className="text-[15px] font-semibold tracking-tight text-stone-100">TPMail</p>
                  <p className="text-sm text-stone-400">临时邮箱聚合</p>
                </div>
              </div>
            </div>

            <section
              className="relative mt-4 shrink-0 lg:overflow-visible"
              onMouseLeave={() => setHoveredProviderId(null)}
            >
              <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-stone-500">
                <span>聚合源</span>
                <span>{enabledProviders.length} 个在线</span>
              </div>

              <div className="space-y-1" role="radiogroup" aria-label="聚合源选择">
                {providerOptions.map((provider) => {
                  return (
                    <ProviderSelectionCard
                      key={provider.id}
                      provider={provider}
                      actualSelected={provider.id === selectedProvider}
                      onClick={() => handleProviderSelection(provider)}
                      onMouseEnter={() => setHoveredProviderId(provider.id)}
                      onFocus={() => setHoveredProviderId(provider.id)}
                      onBlur={() => setHoveredProviderId((current) => (current === provider.id ? null : current))}
                    />
                  );
                })}
              </div>

              {previewProviderMeta ? (
                <>
                  <div className="mt-4 lg:hidden">
                    <ProviderPreviewCard provider={previewProviderMeta} selected={previewProviderMeta.id === selectedProvider} />
                  </div>

                  <div className="absolute left-[calc(100%+20px)] top-8 hidden w-[296px] lg:block">
                    <ProviderPreviewCard provider={previewProviderMeta} selected={previewProviderMeta.id === selectedProvider} arrow />
                  </div>
                </>
              ) : null}
            </section>

            <div className="mt-5 shrink-0 pr-1">
              <div className="space-y-4">
                <section className="space-y-2.5">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500">地址参数</div>

                  <ParameterField label="邮箱前缀">
                    <div className="relative">
                      <input
                        value={aliasInput}
                        onChange={(event) => setAliasInput(event.target.value.replace(/[^a-zA-Z0-9._-]/g, ""))}
                        placeholder="例如 inbox-demo"
                        className="h-7 w-full border-0 bg-transparent pr-8 text-[12px] font-medium text-stone-100 outline-none placeholder:text-stone-500"
                      />
                      <button
                        type="button"
                        onClick={applyRandomAlias}
                        aria-label="随机生成前缀"
                        className="absolute right-0 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-xl text-stone-300 transition hover:bg-white/[0.05]"
                      >
                        <ShuffleIcon className="h-3 w-3" />
                      </button>
                    </div>
                  </ParameterField>

                  <ParameterField label="邮箱后缀" helper={domainOptions.length > 1 ? "下方小组件切换，输入框本身不展开" : undefined}>
                    <div className="min-h-7 text-[12px] font-medium leading-7 text-stone-100">
                      {selectedDomain ||
                        (selectedProviderMeta.accessMode === "api_key" && !selectedProviderApiKey
                          ? "先输入 API key 再载入域名"
                          : loadingDomains
                            ? "载入中..."
                            : "自动分配 / 固定域名")}
                    </div>
                  </ParameterField>

                  {domainOptions.length > 1 ? (
                    <div className="grid grid-cols-2 gap-1.5 pl-1">
                      {domainOptions.map((option) => {
                        const active = option.domain === selectedDomain;

                        return (
                          <button
                            key={`${option.provider}:${option.domain}`}
                            type="button"
                            onClick={() => setSelectedDomain(option.domain)}
                            className={`min-h-7 rounded-full border px-2.5 text-left text-[11px] transition ${
                              active
                                ? "border-transparent bg-[#1d1f47] text-[#9bd0ff]"
                                : "border-white/8 bg-white/[0.02] text-stone-300 hover:bg-white/[0.04]"
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  <ParameterField
                    label={credentialFieldMeta.label}
                    disabled={!credentialFieldMeta.editable}
                    helper={credentialFieldMeta.helper}
                    action={
                      credentialDocsLink ? (
                        <a
                          href={credentialDocsLink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[9px] font-medium normal-case tracking-normal text-[#8cc8ff] transition hover:text-white"
                        >
                          申请
                        </a>
                      ) : null
                    }
                  >
                    <input
                      value={selectedProviderMeta.accessMode === "api_key" ? selectedProviderApiKey : ""}
                      onChange={(event) => {
                        if (selectedProviderMeta.accessMode !== "api_key") {
                          return;
                        }

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
                      disabled={!credentialFieldMeta.editable}
                      placeholder={credentialFieldMeta.placeholder}
                      className="h-7 w-full border-0 bg-transparent text-[12px] font-medium text-stone-100 outline-none placeholder:text-stone-500 disabled:cursor-not-allowed disabled:text-stone-500"
                    />
                  </ParameterField>

                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => createMailboxSession(selectedProvider)}
                      disabled={busy || !selectedProviderMeta.enabled || (selectedProviderMeta.accessMode === "api_key" && !selectedProviderApiKey)}
                      className="min-h-9 flex-1 rounded-[15px] border-2 border-black bg-[#ff90e8] px-3 text-[12px] font-semibold text-black shadow-[2px_2px_0_0_#000000] transition hover:-translate-y-0.5 hover:translate-x-0.5 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                        {busy ? "创建中..." : renderMailbox ? "重建地址" : "创建临时邮箱"}
                    </button>
                    <button
                      type="button"
                      onClick={createRandomMailbox}
                      disabled={busy || !selectedProviderMeta.enabled || (selectedProviderMeta.accessMode === "api_key" && !selectedProviderApiKey)}
                      aria-label="随机生成邮箱"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[15px] border-2 border-black bg-white text-stone-900 shadow-[2px_2px_0_0_#000000] transition hover:-translate-y-0.5 hover:translate-x-0.5 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <ShuffleIcon className="h-3 w-3" />
                    </button>
                  </div>
                </section>
              </div>
            </div>

            <section className="mt-auto shrink-0 border-t border-white/10 pt-4">
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-stone-100">当前聚合源：{selectedProviderMeta.name}</p>
                <p className="text-[11px] leading-5 text-stone-400">{getProviderPreviewCopy(selectedProviderMeta)}</p>
                <a
                  href={selectedProviderMeta.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-[11px] text-stone-300 transition hover:text-white"
                >
                  {selectedProviderMeta.accessMode === "api_key" ? "申请 API key / 查看文档" : "查看文档"}
                  <ExternalIcon className="h-3.5 w-3.5" />
                </a>
              </div>
            </section>
          </div>
        </aside>

        <section className="flex min-h-dvh flex-1 flex-col">
          <header className="border-b border-white/10 px-5 py-4 sm:px-8">
            <div className="flex flex-col gap-3 xl:grid xl:grid-cols-[minmax(0,560px)_minmax(220px,1fr)_auto] xl:items-center xl:gap-4">
              <div className="relative min-w-0 flex-1 xl:max-w-[560px]" ref={historyMenuRef}>
                <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-[#202226] shadow-[0_14px_30px_rgba(0,0,0,0.18)]">
                  <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.06),rgba(255,255,255,0.01))]" />
                  <AnimatedRefreshFill
                    active={clientReady && Boolean(renderMailbox) && refreshCycleStartedAt !== null}
                    cycleKey={refreshCycleStartedAt ?? "idle"}
                  />
                  <div className="absolute inset-[1px] rounded-[22px] border border-white/10" aria-hidden="true" />
                  <div className="relative z-10 flex min-h-12 items-center gap-3 px-4 py-3 text-stone-100">
                    <span className="text-stone-300">
                      <InboxIcon className="h-4.5 w-4.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[15px] font-medium">
                      {renderMailbox ? getMailboxDisplayAddress(renderMailbox) : `${selectedProviderMeta.name} · 尚未创建邮箱`}
                    </span>
                    <button
                      type="button"
                      onClick={copyAddress}
                      disabled={!renderMailbox}
                      aria-label="复制邮箱地址"
                      className="text-stone-400 transition hover:text-white disabled:cursor-not-allowed disabled:text-stone-600"
                    >
                      <CopyIcon />
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryMenuOpen((current) => !current)}
                      aria-label="展开缓存邮箱记录"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-stone-300 transition hover:bg-white/[0.06] hover:text-white"
                    >
                      <ChevronDownIcon className={`h-4 w-4 transition ${historyMenuOpen ? "rotate-180" : "rotate-0"}`} />
                    </button>
                  </div>
                </div>

                {historyMenuOpen ? (
                  <div className="absolute left-0 top-[calc(100%+10px)] z-30 w-full max-w-[560px] rounded-[24px] border border-white/10 bg-[#1f2125] p-3 shadow-[0_18px_40px_rgba(0,0,0,0.28)]">
                    <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-stone-400">
                      <span>缓存邮箱记录</span>
                        <span>{renderRecentMailboxes.length} 条</span>
                      </div>
                    {renderRecentMailboxes.length > 0 ? (
                      <div className="space-y-1.5">
                        {renderRecentMailboxes.map((item) => {
                          const activeMailbox = renderMailbox ? getMailboxIdentity(renderMailbox) === getMailboxIdentity(item) : false;

                          return (
                            <div key={getMailboxIdentity(item)} className="flex items-center gap-2 rounded-[18px] border border-white/8 bg-white/[0.02] px-2.5 py-2">
                              <button
                                type="button"
                                onClick={() => {
                                  activateMailbox(item, `已从缓存记录切换到 ${getMailboxDisplayAddress(item)}。`);
                                  setHistoryMenuOpen(false);
                                }}
                                className="min-w-0 flex-1 text-left"
                              >
                                <span className={`block truncate font-mono text-[12px] ${activeMailbox ? "text-[#8cc8ff]" : "text-stone-100"}`}>
                                  {getMailboxDisplayAddress(item)}
                                </span>
                                <span className="mt-0.5 block text-[10px] text-stone-500">{item.providerLabel}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => removeMailboxFromHistory(item)}
                                aria-label={`删除 ${getMailboxDisplayAddress(item)}`}
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-stone-400 transition hover:bg-white/[0.05] hover:text-white"
                              >
                                <CloseIcon className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-[18px] border border-dashed border-white/8 px-3 py-4 text-center text-[12px] text-stone-500">
                        当前还没有缓存邮箱记录。
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="hidden min-w-0 xl:flex xl:min-h-12 xl:items-center xl:rounded-2xl xl:border xl:border-white/8 xl:bg-white/[0.02] xl:px-4 xl:py-3">
                <p className="line-clamp-2 text-[12px] leading-6 text-stone-400">{notice}</p>
              </div>

              <div className="relative flex flex-wrap items-center justify-end gap-2 xl:justify-self-end">
                <button
                  type="button"
                  onClick={() => setRefreshSequence((current) => current + 1)}
                  disabled={!renderMailbox || loadingMessages}
                  aria-label="刷新收件箱"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03] text-stone-200 transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:text-stone-600"
                >
                  <RefreshIcon className="h-4.5 w-4.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryPanelOpen((current) => !current)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.03] px-3 text-sm font-medium text-stone-200 transition hover:bg-white/[0.05]"
                >
                  <PanelIcon className="h-4 w-4" />
                  管理
                </button>
                <Pill>{loadingMessages ? "同步中" : `${refreshSecondsRemaining}s 自动刷新`}</Pill>
              </div>
            </div>
            <p className="mt-3 text-sm leading-7 text-stone-400 xl:hidden">{notice}</p>
          </header>

          <main className="relative flex min-h-0 flex-1 overflow-hidden">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(124,192,255,0.08),transparent_24%),radial-gradient(circle_at_82%_12%,rgba(168,85,247,0.12),transparent_22%),linear-gradient(180deg,#1f2023_0%,#1b1c1f_100%)]" />
              <div
                className="absolute inset-0 opacity-35"
                style={{
                  backgroundImage:
                    "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
                  backgroundSize: "32px 32px",
                  maskImage: "linear-gradient(to bottom, rgba(255,255,255,0.95), rgba(255,255,255,0.15))",
                }}
              />
              <div className="absolute -right-20 top-20 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl" />
              <div className="absolute bottom-[-120px] left-[-80px] h-72 w-72 rounded-full bg-violet-500/10 blur-3xl" />
            </div>

            <div className="relative z-10 flex min-h-0 flex-1 flex-col">
              {renderMailbox && renderMessages.length > 0 ? (
                <div className="grid min-h-0 flex-1 lg:grid-cols-[360px_minmax(0,1fr)]">
                <section className="min-h-0 border-b border-white/10 px-5 py-6 lg:border-b-0 lg:border-r lg:px-6">
                  <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                      <h1 className="text-[44px] font-semibold tracking-tight text-stone-100">收件箱</h1>
                      <p className="mt-3 text-sm leading-7 text-stone-400">来自 {selectedProviderMeta.name} 的邮件会持续出现在这里。</p>
                    </div>
                    <span className="text-sm text-stone-500">{renderMessages.length} 封</span>
                  </div>

                  <div className="min-h-0 space-y-3 overflow-y-auto pr-1 lg:h-[calc(100dvh-220px)]">
                    {renderMessages.map((message) => {
                      const active = renderActiveMessage?.id === message.id;
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
                  {renderActiveMessage ? (
                    <div className="h-full w-full overflow-y-auto pr-1">
                      <div className="w-full space-y-8">
                        <div>
                          <h2 className="text-3xl font-semibold tracking-tight text-stone-100">{renderActiveMessage.subject}</h2>
                          <div className="mt-5 grid gap-2 text-sm leading-7 text-stone-400">
                            <p><span className="text-stone-500">发件人：</span>{renderActiveMessage.from}</p>
                            {renderActiveMessage.to ? <p><span className="text-stone-500">收件人：</span>{renderActiveMessage.to}</p> : null}
                            <p><span className="text-stone-500">时间：</span>{renderActiveMessage.receivedAt ? new Date(renderActiveMessage.receivedAt).toLocaleString("zh-CN") : "未知"}</p>
                          </div>
                        </div>

                        {renderActiveMessage.attachments.length > 0 ? (
                          <div className="space-y-3 border-t border-white/10 pt-6">
                            <p className="text-sm font-medium text-stone-200">附件</p>
                            <div className="flex flex-wrap gap-2.5">
                              {renderActiveMessage.attachments.map((attachment) =>
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
                                    onClick={() => downloadAttachment(renderActiveMessage.id, attachment.id)}
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
                              {renderActiveMessage.text ?? "无纯文本正文。"}
                            </div>
                          </article>

                          <article className="rounded-3xl border border-white/8 bg-white/[0.03] p-5">
                            <div className="mb-4 flex items-center justify-between gap-3">
                              <p className="text-sm font-medium text-stone-200">HTML 预览</p>
                              <span className="text-xs text-stone-500">沙箱隔离</span>
                            </div>
                            <div className="max-h-[480px] overflow-auto rounded-[22px] border border-stone-300/60 bg-white p-3">
                              {renderActiveMessage.html ? (
                                <iframe
                                  title="邮件 HTML 预览"
                                  srcDoc={renderActiveMessage.html}
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
                {!renderMailbox ? (
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
                        onClick={() => setRefreshSequence((current) => current + 1)}
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
            </div>
          </main>

          {historyPanelOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
              <button type="button" className="absolute inset-0 cursor-default" aria-label="关闭缓存记录管理弹窗" onClick={() => setHistoryPanelOpen(false)} />
              <div ref={historyPanelRef} className="relative z-10 flex max-h-[min(82vh,840px)] w-full max-w-5xl flex-col overflow-hidden rounded-[30px] border border-white/10 bg-[#1f2125] shadow-[0_26px_80px_rgba(0,0,0,0.42)]">
                <div className="flex flex-col gap-4 border-b border-white/8 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-lg font-semibold text-stone-100">缓存邮箱记录管理</p>
                    <p className="mt-1 text-sm text-stone-400">按表格查看当前浏览器里的所有缓存邮箱，支持多选、删除、排序与快速切换。</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex min-h-10 items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.03] px-3 text-sm text-stone-300">
                      <span className="text-stone-400">排序</span>
                      <select
                        value={historySort}
                        onChange={(event) => setHistorySort(event.target.value as "recent" | "address" | "provider")}
                        className="bg-transparent text-sm text-stone-100 outline-none"
                      >
                        <option value="recent">最近使用</option>
                        <option value="address">邮箱地址</option>
                        <option value="provider">聚合源</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => deleteHistoryEntries(renderSortedRecentMailboxes.filter((item) => selectedHistoryIds.includes(getMailboxIdentity(item))))}
                      disabled={selectedHistoryIds.length === 0}
                      className="inline-flex min-h-10 items-center gap-2 rounded-2xl border border-[#5b2438] bg-[#3b1625] px-3 text-sm font-medium text-[#ffbddb] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      删除已选
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryPanelOpen(false)}
                      className="inline-flex min-h-10 items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.03] px-3 text-sm font-medium text-stone-200 transition hover:bg-white/[0.05]"
                    >
                      <CloseIcon className="h-4 w-4" />
                      关闭
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
                  {renderSortedRecentMailboxes.length > 0 ? (
                    <table className="w-full min-w-[760px] border-separate border-spacing-y-2 text-left">
                      <thead>
                        <tr className="text-xs uppercase tracking-[0.16em] text-stone-500">
                          <th className="w-14 px-3 py-2">
                            <input
                              type="checkbox"
                              checked={renderSortedRecentMailboxes.length > 0 && selectedHistoryIds.length === renderSortedRecentMailboxes.length}
                              onChange={(event) => toggleAllHistorySelection(event.target.checked)}
                              aria-label="全选缓存邮箱记录"
                              className="h-4 w-4 rounded border-white/15 bg-transparent"
                            />
                          </th>
                          <th className="px-3 py-2">邮箱地址</th>
                          <th className="px-3 py-2">聚合源</th>
                          <th className="px-3 py-2">状态</th>
                          <th className="w-[180px] px-3 py-2 text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {renderSortedRecentMailboxes.map((item) => {
                          const mailboxId = getMailboxIdentity(item);
                          const activeMailbox = renderMailbox ? getMailboxIdentity(renderMailbox) === mailboxId : false;
                          const checked = selectedHistoryIds.includes(mailboxId);

                          return (
                            <tr key={mailboxId} className="rounded-[22px] border border-white/8 bg-white/[0.03] text-sm text-stone-200">
                              <td className="rounded-l-[22px] border-y border-l border-white/8 px-3 py-3 align-top">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleHistorySelection(mailboxId)}
                                  aria-label={`选择 ${getMailboxDisplayAddress(item)}`}
                                  className="mt-1 h-4 w-4 rounded border-white/15 bg-transparent"
                                />
                              </td>
                              <td className="border-y border-white/8 px-3 py-3 align-top">
                                <p className={`font-mono text-[13px] ${activeMailbox ? "text-[#8cc8ff]" : "text-stone-100"}`}>{getMailboxDisplayAddress(item)}</p>
                              </td>
                              <td className="border-y border-white/8 px-3 py-3 align-top text-stone-300">{item.providerLabel}</td>
                              <td className="border-y border-white/8 px-3 py-3 align-top">
                                <span className={`inline-flex min-h-8 items-center rounded-full px-3 text-xs ${activeMailbox ? "bg-[#1d1f47] text-[#8cc8ff]" : "bg-white/[0.04] text-stone-400"}`}>
                                  {activeMailbox ? "当前使用中" : "已缓存"}
                                </span>
                              </td>
                              <td className="rounded-r-[22px] border-y border-r border-white/8 px-3 py-3 align-top">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      activateMailbox(item, `已从缓存记录切换到 ${getMailboxDisplayAddress(item)}。`);
                                      setHistoryPanelOpen(false);
                                    }}
                                    className="inline-flex min-h-9 items-center rounded-xl border border-[#2d3563] bg-[#1d1f47] px-3 text-xs font-medium text-[#8cc8ff] transition hover:brightness-110"
                                  >
                                    切换
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeMailboxFromHistory(item)}
                                    className="inline-flex min-h-9 items-center rounded-xl border border-white/8 bg-white/[0.03] px-3 text-xs font-medium text-stone-300 transition hover:bg-white/[0.05] hover:text-white"
                                  >
                                    删除
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="flex min-h-[240px] items-center justify-center rounded-[24px] border border-dashed border-white/8 bg-white/[0.02] px-6 text-center text-sm text-stone-500">
                      当前没有可管理的缓存记录。
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
