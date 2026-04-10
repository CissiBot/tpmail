import { ProviderId, ProviderDescriptor } from "@/lib/tpmail/types";
import { ProviderAdapter } from "@/server/tpmail/providers/base";
import { catchmailAdapter } from "@/server/tpmail/providers/catchmail";
import { duckmailAdapter } from "@/server/tpmail/providers/duckmail";
import { inboxesAdapter } from "@/server/tpmail/providers/inboxes";
import { mailTmAdapter } from "@/server/tpmail/providers/mail-tm";
import { maildropAdapter } from "@/server/tpmail/providers/maildrop";
import { tempMailIoAdapter } from "@/server/tpmail/providers/temp-mail-io";
import { tempmailLolAdapter } from "@/server/tpmail/providers/tempmail-lol";

const providers: Record<ProviderId, ProviderAdapter> = {
  catchmail: catchmailAdapter,
  maildrop: maildropAdapter,
  inboxes: inboxesAdapter,
  mail_tm: mailTmAdapter,
  duckmail: duckmailAdapter,
  tempmail_lol: tempmailLolAdapter,
  temp_mail_io: tempMailIoAdapter,
};

export function getProviderAdapter(providerId: ProviderId) {
  return providers[providerId];
}

export function listProviderDescriptors(): ProviderDescriptor[] {
  return Object.values(providers).map((item) => item.descriptor);
}
