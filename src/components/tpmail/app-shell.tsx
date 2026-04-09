"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  MailboxSession,
  MessageDetail,
  MessageSummary,
  ProviderDomainOption,
  ProviderDescriptor,
  ProviderId,
} from "@/lib/tpmail/types";
import { formatRelativeExpiry } from "@/lib/tpmail/utils";

type ErrorLike = {
  error?: {
    message?: string;
  };
};

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "danger" | "success";
}) {
  const tones = {
    neutral: "border-white/10 bg-white/6 text-slate-300",
    accent: "border-emerald-400/30 bg-emerald-400/12 text-emerald-100",
    danger: "border-amber-400/30 bg-amber-400/12 text-amber-100",
    success: "border-emerald-400/30 bg-emerald-400/12 text-emerald-100",
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">{children}</p>;
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="mt-1.5 text-xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-1.5 line-clamp-2 text-[11px] leading-5 text-slate-500">{detail}</p>
    </div>
  );
}

function formatAccessMode(mode: MailboxSession["accessMode"]) {
  switch (mode) {
    case "public_address":
      return "公共地址访问";
    case "inbox_token":
      return "后端托管 token";
    case "account_token":
      return "账号 token";
    case "api_key":
      return "API Key";
    default:
      return mode;
  }
}

export function AppShell({ initialProviders }: { initialProviders: ProviderDescriptor[] }) {
  const [providers] = useState(initialProviders);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("catchmail");
  const [mailbox, setMailbox] = useState<MailboxSession | null>(null);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [activeMessage, setActiveMessage] = useState<MessageDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingMessageId, setLoadingMessageId] = useState<string | null>(null);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [notice, setNotice] = useState<string>("先选择一个 provider，再生成临时邮箱地址。系统会自动轮询收件箱。 ");
  const [aliasInput, setAliasInput] = useState("");
  const [domainOptions, setDomainOptions] = useState<ProviderDomainOption[]>([]);
  const [selectedDomain, setSelectedDomain] = useState("");

  const enabledProviders = useMemo(() => providers.filter((item) => item.enabled), [providers]);
  const selectedProviderMeta = useMemo(
    () => providers.find((provider) => provider.id === selectedProvider) ?? providers[0],
    [providers, selectedProvider]
  );

  const detailEmptyMessage = useMemo(() => {
    if (!mailbox) {
      return "先生成地址，再从左侧选择一封邮件打开。";
    }

    if (messages.length === 0) {
      return "当前会话还没有收到邮件。保持页面打开，系统会继续自动轮询。";
    }

    return "从左侧消息列表选择一封邮件，右侧会立即展开完整内容。";
  }, [mailbox, messages.length]);

  function resetWorkspace(nextProvider: ProviderDescriptor) {
    setSelectedProvider(nextProvider.id);
    setMailbox(null);
    setMessages([]);
    setActiveMessage(null);
    setSelectedDomain("");
    setNotice(
      nextProvider.enabled
        ? `已切换到 ${nextProvider.name}，请重新生成一个邮箱地址。`
        : `${nextProvider.name} 当前未启用，暂时不能创建会话。`
    );
  }

  async function createMailboxSession(provider: ProviderId) {
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
          alias: aliasInput.trim() || undefined,
          domain: selectedDomain || undefined,
        }),
      });
      const data = (await response.json()) as { mailbox?: MailboxSession } & ErrorLike;

      if (!response.ok || !data.mailbox) {
        throw new Error(data.error?.message ?? "创建邮箱失败");
      }

      setMailbox(data.mailbox);
      setNotice(`已创建 ${data.mailbox.providerLabel} 邮箱，系统正在同步最新收件箱。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建邮箱失败");
    } finally {
      setBusy(false);
    }
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
        });
        const data = (await response.json()) as { messages?: MessageSummary[] } & ErrorLike;

        if (!response.ok || !data.messages) {
          throw new Error(data.error?.message ?? "收件箱拉取失败");
        }

        setMessages(data.messages);
        setNotice(
          data.messages.length > 0
            ? `已同步 ${data.messages.length} 封邮件。`
            : "收件箱当前为空，系统会继续自动刷新。"
        );
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "收件箱拉取失败");
      } finally {
        setLoadingMessages(false);
      }
    },
    [mailbox]
  );

  async function openMessage(messageId: string) {
    if (!mailbox) {
      return;
    }

    setLoadingMessageId(messageId);
    try {
      const response = await fetch(`/api/mailboxes/${mailbox.id}/messages/${messageId}`, {
        cache: "no-store",
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

      setLoadingDomains(true);
      try {
        const response = await fetch(`/api/providers/${selectedProviderMeta.id}/domains`, {
          cache: "no-store",
        });
        const data = (await response.json()) as { domains?: ProviderDomainOption[] } & ErrorLike;

        if (!response.ok || !data.domains) {
          throw new Error(data.error?.message ?? "域名列表获取失败");
        }

        if (cancelled) {
          return;
        }

        setDomainOptions(data.domains);
        setSelectedDomain((current) => {
          if (data.domains?.some((item) => item.domain === current)) {
            return current;
          }

          const fallback = data.domains?.find((item) => item.isDefault)?.domain ?? data.domains?.[0]?.domain ?? "";
          return fallback;
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
  }, [selectedProviderMeta]);

  return (
    <div className="h-dvh overflow-hidden bg-[#07090c] text-slate-100">
      <div className="mx-auto flex h-dvh w-full max-w-[1600px] flex-col px-4 py-4 sm:px-6 lg:px-8 lg:py-5">
        <header className="mb-4 rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(13,17,23,0.98),rgba(10,13,18,0.94))] px-4 py-4 shadow-[0_18px_56px_rgba(0,0,0,0.34)] sm:px-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-9 items-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 text-sm font-semibold tracking-tight text-emerald-100">
                  TPMail
                </span>
                <Badge tone="success">{enabledProviders.length} 个在线</Badge>
                <Badge>{mailbox ? formatAccessMode(mailbox.accessMode) : "等待会话"}</Badge>
                <Badge>{loadingMessages ? "同步中" : "15s 轮询"}</Badge>
              </div>

              <div className="flex flex-wrap gap-2.5">
                {providers.map((provider) => {
                  const active = provider.id === selectedProvider;

                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => resetWorkspace(provider)}
                      aria-disabled={!provider.enabled}
                      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 font-mono text-[13px] transition ${
                        active
                          ? "border-emerald-400/45 bg-emerald-400/12 text-white"
                          : provider.enabled
                            ? "border-white/10 bg-white/[0.04] text-slate-300 hover:border-white/18 hover:bg-white/[0.08]"
                            : "border-white/8 bg-white/[0.02] text-slate-500 opacity-55"
                      }`}
                    >
                      <span className="font-medium">{provider.name}</span>
                      <span className="text-[11px] text-slate-400">{provider.enabled ? provider.tier : "关闭"}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.25fr)_210px_210px_auto_auto] xl:min-w-[980px]">
              <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">当前地址</p>
                <p className="mt-2 truncate font-mono text-sm text-white sm:text-[15px]">{mailbox?.address.address ?? "尚未生成地址"}</p>
                <p className="mt-2 text-xs text-slate-400">{mailbox ? formatRelativeExpiry(mailbox.expiresAt) : selectedProviderMeta.limitations[0]}</p>
              </div>

              <label className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">邮箱前缀</p>
                <input
                  value={aliasInput}
                  onChange={(event) => setAliasInput(event.target.value.replace(/[^a-zA-Z0-9._-]/g, ""))}
                  placeholder="例如 inbox-demo"
                  className="mt-2 w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                />
              </label>

              <label className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">邮箱后缀</p>
                <select
                  value={selectedDomain}
                  onChange={(event) => setSelectedDomain(event.target.value)}
                  disabled={loadingDomains || domainOptions.length === 0}
                  className="mt-2 w-full bg-transparent text-sm text-white outline-none disabled:cursor-not-allowed disabled:text-slate-500"
                >
                  {domainOptions.length === 0 ? (
                    <option value="">{loadingDomains ? "载入中..." : "自动分配 / 固定域名"}</option>
                  ) : (
                    domainOptions.map((option) => (
                      <option key={`${option.provider}:${option.domain}`} value={option.domain} className="bg-[#0d1117] text-white">
                        {option.label}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <button
                type="button"
                onClick={() => createMailboxSession(selectedProvider)}
                disabled={busy || !selectedProviderMeta.enabled}
                className="rounded-xl bg-[linear-gradient(135deg,#22c55e,#16a34a)] px-4 py-3 text-sm font-semibold text-[#03120a] shadow-[0_16px_38px_rgba(22,163,74,0.25)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy
                  ? "创建中..."
                  : !selectedProviderMeta.enabled
                    ? "未启用"
                    : mailbox
                      ? "重建地址"
                      : "生成地址"}
              </button>

              <button
                type="button"
                onClick={() => refreshMessages()}
                disabled={!mailbox || loadingMessages}
                className="rounded-xl border border-white/12 bg-white/[0.05] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loadingMessages ? "同步中..." : "刷新"}
              </button>
            </div>
          </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,0.9fr)_minmax(0,0.9fr)]">
              <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-2.5 text-sm text-slate-400 lg:col-span-2">
                {notice}
              </div>
            <StatCard label="收件箱状态" value={messages.length > 0 ? `${messages.length} 封` : "空箱"} detail={loadingMessages ? "正在同步最新消息。" : "消息区会在下方实时更新。"} />
            <StatCard label="后缀来源" value={selectedDomain || "自动"} detail={domainOptions.length > 0 ? `已加载 ${domainOptions.length} 个可用域名。` : "当前 provider 没有可选后缀列表。"} />
          </div>
        </header>

        <main className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
          <section className="min-h-0 rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(16,21,29,0.98),rgba(11,15,20,0.94))] p-4 shadow-[0_18px_56px_rgba(0,0,0,0.28)] lg:p-5">
            <div className="mb-3 flex items-end justify-between gap-3 border-b border-white/8 pb-3">
              <div>
                <SectionEyebrow>收件箱</SectionEyebrow>
                <h2 className="mt-1.5 text-lg font-semibold text-white">消息列表</h2>
              </div>
              <div className="flex gap-2">
                <Badge>{messages.length} 封</Badge>
                <Badge>{mailbox ? selectedProviderMeta.name : "未创建"}</Badge>
              </div>
            </div>

            <div className="h-[calc(100%-4.5rem)] overflow-auto pr-1">
              <div className="space-y-3">
                {messages.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/12 bg-white/[0.03] px-5 py-10 text-sm leading-7 text-slate-400">
                    {mailbox ? "当前会话还没有收到邮件，保持页面打开即可继续自动轮询。" : "先在顶部生成地址，消息列表就会开始工作。"}
                  </div>
                ) : (
                  messages.map((message) => {
                    const active = activeMessage?.id === message.id;

                    return (
                      <button
                        key={message.id}
                        type="button"
                        onClick={() => openMessage(message.id)}
                        className={`w-full rounded-xl border p-4 text-left transition ${
                          active
                            ? "border-emerald-400/35 bg-[linear-gradient(135deg,rgba(34,197,94,0.10),rgba(11,15,20,0.92))] shadow-[0_14px_30px_rgba(34,197,94,0.08)]"
                            : "border-white/10 bg-white/[0.03] hover:border-white/18 hover:bg-white/[0.05]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1.5">
                            <p className="truncate text-sm font-semibold text-white">{message.subject}</p>
                            <p className="truncate text-xs text-slate-400">{message.from}</p>
                          </div>
                          <span className="shrink-0 rounded-full border border-white/8 bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-slate-400">
                            {message.receivedAt
                              ? new Date(message.receivedAt).toLocaleTimeString("zh-CN", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "--:--"}
                          </span>
                        </div>
                        {message.snippet ? <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-300">{message.snippet}</p> : null}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </section>

          <section className="min-h-0 rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(16,21,29,0.98),rgba(11,15,20,0.94))] p-4 shadow-[0_18px_56px_rgba(0,0,0,0.28)] lg:p-5">
            <div className="mb-3 flex items-end justify-between gap-3 border-b border-white/8 pb-3">
              <div>
                <SectionEyebrow>阅读区</SectionEyebrow>
                <h2 className="mt-1.5 text-lg font-semibold text-white">邮件详情</h2>
              </div>
              {loadingMessageId ? <Badge tone="accent">正在载入</Badge> : <Badge>隔离 HTML 预览</Badge>}
            </div>

            {activeMessage ? (
              <div className="h-[calc(100%-4.5rem)] overflow-auto pr-1">
                <div className="space-y-4">
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="space-y-2">
                        <h3 className="text-xl font-semibold tracking-tight text-white">{activeMessage.subject}</h3>
                        <div className="grid gap-2 text-sm text-slate-300">
                          <p><span className="text-slate-500">发件人：</span>{activeMessage.from}</p>
                          {activeMessage.to ? <p><span className="text-slate-500">收件人：</span>{activeMessage.to}</p> : null}
                          <p><span className="text-slate-500">时间：</span>{activeMessage.receivedAt ? new Date(activeMessage.receivedAt).toLocaleString("zh-CN") : "未知"}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 xl:justify-end">
                        <Badge>{activeMessage.hasAttachments ? "含附件" : "无附件"}</Badge>
                        <Badge tone="accent">{activeMessage.provider}</Badge>
                      </div>
                    </div>
                  </div>

                  {activeMessage.attachments.length > 0 ? (
                    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-white">附件</p>
                        <p className="text-xs text-slate-500">仅在 provider 支持时可下载</p>
                      </div>
                      <div className="flex flex-wrap gap-2.5">
                        {activeMessage.attachments.map((attachment) => (
                          <a
                            key={attachment.id}
                            href={
                              attachment.downloadMode === "unsupported"
                                ? undefined
                                : `/api/mailboxes/${activeMessage.mailboxId}/messages/${activeMessage.id}/attachments/${attachment.id}`
                            }
                            aria-disabled={attachment.downloadMode === "unsupported"}
                            className={`rounded-full border px-3 py-1.5 text-xs transition ${
                              attachment.downloadMode === "unsupported"
                                ? "cursor-not-allowed border-white/10 bg-white/5 text-slate-500"
                                : "border-emerald-400/30 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/18"
                            }`}
                          >
                            {attachment.downloadMode === "unsupported"
                              ? `${attachment.filename}（暂不支持）`
                              : `下载 ${attachment.filename}`}
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
                    <article className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-white">纯文本</p>
                        <Badge>稳定阅读</Badge>
                      </div>
                      <div className="max-h-[calc(100dvh-320px)] overflow-auto whitespace-pre-wrap text-sm leading-7 text-slate-300">
                        {activeMessage.text ?? "无纯文本正文。"}
                      </div>
                    </article>

                    <article className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-white">HTML 预览</p>
                        <Badge tone="accent">沙箱隔离</Badge>
                      </div>
                      <div className="max-h-[calc(100dvh-320px)] overflow-auto rounded-[20px] border border-slate-200/70 bg-white p-3 shadow-inner shadow-slate-200/60">
                        {activeMessage.html ? (
                          <iframe
                            title="邮件 HTML 预览"
                            srcDoc={activeMessage.html}
                            sandbox=""
                            referrerPolicy="no-referrer"
                            className="min-h-[360px] w-full rounded-xl border-0 bg-white"
                          />
                        ) : (
                          <div className="flex min-h-[220px] items-center justify-center rounded-xl bg-slate-50 px-6 text-center text-sm leading-7 text-slate-500">
                            这封邮件没有提供 HTML 正文，当前只展示纯文本内容。
                          </div>
                        )}
                      </div>
                    </article>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-[calc(100%-4.5rem)] items-center justify-center rounded-xl border border-dashed border-white/12 bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.08),transparent_30%),rgba(255,255,255,0.02)] px-8 text-center">
                <div className="max-w-xl space-y-4">
                  <SectionEyebrow>准备阅读</SectionEyebrow>
                  <h3 className="text-2xl font-semibold tracking-tight text-white">{detailEmptyMessage}</h3>
                  <p className="text-sm leading-7 text-slate-400">
                    {mailbox
                      ? "消息详情会在这里展开，包括元信息、纯文本正文和隔离后的 HTML 预览。"
                      : "创建会话之后，系统会自动开始轮询，消息列表和阅读区会按顺序进入工作状态。"}
                  </p>
                </div>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
