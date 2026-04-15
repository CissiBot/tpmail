import { MailAddress, MailboxSession, ProviderCapabilities, ProviderId } from "@/lib/tpmail/types";

export const MAILBOX_SNAPSHOT_HEADER = "x-tpmail-mailbox";

export type PublicMailboxSession = Omit<MailboxSession, "metadata">;

const PROVIDER_IDS: ProviderId[] = [
  "catchmail",
  "maildrop",
  "inboxes",
  "mail_tm",
  "duckmail",
  "tempmail_lol",
  "temp_mail_io",
];

function toBase64Url(value: string) {
  if (typeof window === "undefined") {
    return Buffer.from(value, "utf8").toString("base64url");
  }

  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  if (typeof window === "undefined") {
    return Buffer.from(value, "base64url").toString("utf8");
  }

  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && PROVIDER_IDS.includes(value as ProviderId);
}

function isMailAddress(value: unknown): value is MailAddress {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.address === "string" &&
    typeof value.localPart === "string" &&
    typeof value.domain === "string"
  );
}

function isProviderCapabilities(value: unknown): value is ProviderCapabilities {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.createMailbox === "boolean" &&
    typeof value.listMessages === "boolean" &&
    typeof value.getMessage === "boolean" &&
    typeof value.getAttachments === "boolean" &&
    typeof value.listDomains === "boolean" &&
    typeof value.customDomain === "boolean"
  );
}

function isMailboxMetadata(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((item) => typeof item === "string");
}

export function isStatelessMailboxSession(mailbox: Pick<MailboxSession, "accessMode">) {
  return mailbox.accessMode === "public_address";
}

export function isBrowserManagedMailboxSession(mailbox: Pick<MailboxSession, "accessMode" | "metadata">) {
  if (mailbox.accessMode === "public_address") {
    return true;
  }

  if (mailbox.accessMode === "account_token" || mailbox.accessMode === "inbox_token") {
    return Boolean(mailbox.metadata?.token);
  }

  if (mailbox.accessMode === "api_key") {
    return Boolean(mailbox.metadata?.apiKey);
  }

  return false;
}

export function isPublicMailboxSession(value: unknown): value is PublicMailboxSession {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    isProviderId(value.provider) &&
    typeof value.providerLabel === "string" &&
    isMailAddress(value.address) &&
    (value.accessMode === "public_address" ||
      value.accessMode === "inbox_token" ||
      value.accessMode === "account_token" ||
      value.accessMode === "api_key") &&
    isProviderCapabilities(value.capabilities) &&
    typeof value.createdAt === "string" &&
    (typeof value.expiresAt === "string" || value.expiresAt === null)
  );
}

export function isMailboxSnapshot(value: unknown): value is MailboxSession {
  if (!isPublicMailboxSession(value)) {
    return false;
  }

  const metadata = isRecord(value) ? Reflect.get(value, "metadata") : undefined;
  return metadata === undefined || isMailboxMetadata(metadata);
}

export function encodeMailboxSnapshot(mailbox: MailboxSession | PublicMailboxSession) {
  return toBase64Url(JSON.stringify(mailbox));
}

export function decodeMailboxSnapshot(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(value)) as unknown;
    return isMailboxSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function readMailboxSnapshotFromRequest(request: Request) {
  const headerValue = request.headers.get(MAILBOX_SNAPSHOT_HEADER);
  return decodeMailboxSnapshot(headerValue);
}
