import { MailAddress } from "@/lib/tpmail/types";

export function randomLocalPart() {
  return `tp${Math.random().toString(36).slice(2, 10)}`;
}

export function parseAddress(address: string): MailAddress {
  const trimmed = address.trim().toLowerCase();
  const parts = trimmed.split("@");
  if (parts.length !== 2) {
    throw new Error("invalid email address");
  }

  const [localPart, domain] = parts;
  if (!localPart || !domain || /\s/.test(trimmed) || domain.startsWith(".") || domain.endsWith(".")) {
    throw new Error("invalid email address");
  }

  return {
    address: trimmed,
    localPart,
    domain,
  };
}

export function htmlToSnippet(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

export function formatRelativeExpiry(expiresAt: string | null) {
  if (!expiresAt) {
    return "不设固定过期时间";
  }

  const diffMs = new Date(expiresAt).getTime() - Date.now();

  if (diffMs <= 0) {
    return "已过期";
  }

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) {
    return `${minutes} 分钟后过期`;
  }

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `${hours} 小时 ${restMinutes} 分钟后过期`;
}

export function dedupeDomains(domains: string[]) {
  return Array.from(new Set(domains.filter(Boolean)));
}
