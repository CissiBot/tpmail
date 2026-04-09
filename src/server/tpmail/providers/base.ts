import {
  CreateMailboxInput,
  MessageDetail,
  MessageSummary,
  ProviderContext,
  ProviderDescriptor,
  ProviderDomainOption,
} from "@/lib/tpmail/types";

export interface ProviderAdapter {
  descriptor: ProviderDescriptor;
  createMailbox(input: CreateMailboxInput): Promise<ProviderContext["mailbox"]>;
  listMessages(context: ProviderContext): Promise<MessageSummary[]>;
  getMessage(context: ProviderContext, messageId: string): Promise<MessageDetail>;
  listDomains?(): Promise<ProviderDomainOption[]>;
  getAttachmentUrl?(context: ProviderContext, messageId: string, attachmentId: string): Promise<string>;
}
