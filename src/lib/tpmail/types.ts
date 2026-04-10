export type ProviderId =
  | "catchmail"
  | "maildrop"
  | "inboxes"
  | "mail_tm"
  | "duckmail"
  | "tempmail_lol"
  | "temp_mail_io";

export type AccessMode =
  | "public_address"
  | "inbox_token"
  | "account_token"
  | "api_key";

export type ProviderTier = "L1" | "L2" | "L3";

export interface ProviderCapabilities {
  createMailbox: boolean;
  listMessages: boolean;
  getMessage: boolean;
  getAttachments: boolean;
  listDomains: boolean;
  customDomain: boolean;
}

export interface ProviderDescriptor {
  id: ProviderId;
  name: string;
  description: string;
  tier: ProviderTier;
  enabled: boolean;
  productionReady: boolean;
  accessMode: AccessMode;
  capabilities: ProviderCapabilities;
  limitations: string[];
  requiresSecret: boolean;
  docsUrl: string;
  defaultDomain?: string;
}

export interface ProviderDomainOption {
  provider: ProviderId;
  domain: string;
  label: string;
  isDefault: boolean;
}

export interface MailAddress {
  address: string;
  localPart: string;
  domain: string;
}

export interface MailboxSession {
  id: string;
  provider: ProviderId;
  providerLabel: string;
  address: MailAddress;
  accessMode: AccessMode;
  capabilities: ProviderCapabilities;
  createdAt: string;
  expiresAt: string | null;
  metadata?: Record<string, string>;
}

export interface AttachmentSummary {
  id: string;
  filename: string;
  contentType?: string;
  size?: number;
  downloadMode: "proxy" | "redirect" | "unsupported";
}

export interface MessageSummary {
  id: string;
  provider: ProviderId;
  mailboxId: string;
  from: string;
  to?: string;
  subject: string;
  receivedAt: string | null;
  hasAttachments: boolean;
  snippet?: string;
}

export interface MessageDetail extends MessageSummary {
  html: string | null;
  text: string | null;
  attachments: AttachmentSummary[];
}

export interface ProviderApiErrorShape {
  code: string;
  message: string;
  status: number;
  retryable: boolean;
  provider?: ProviderId;
  details?: Record<string, unknown>;
}

export interface ProviderContext {
  mailbox: MailboxSession;
}

export interface CreateMailboxInput {
  provider: ProviderId;
  alias?: string;
  domain?: string;
}
