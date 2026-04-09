import { providerError } from "@/lib/tpmail/errors";
import { ProviderDescriptor } from "@/lib/tpmail/types";
import { ProviderAdapter } from "@/server/tpmail/providers/base";

const descriptor: ProviderDescriptor = {
  id: "temp_mail_io",
  name: "Temp-Mail.io",
  description: "商业 API，适合后端代理接入。",
  tier: "L3",
  enabled: false,
  productionReady: false,
  accessMode: "api_key",
  requiresSecret: true,
  docsUrl: "https://docs.temp-mail.io/docs/getting-started",
  capabilities: {
    createMailbox: true,
    listMessages: true,
    getMessage: true,
    getAttachments: true,
    listDomains: true,
    customDomain: false,
  },
  limitations: ["需要 premium 账户和 API key", "首版未托管商业密钥"],
};

function unsupported(): never {
  throw providerError(
    "PROVIDER_DISABLED",
    "Temp-Mail.io 需要后端托管商业 API key，当前演示版未启用。",
    503,
    descriptor.id
  );
}

export const tempMailIoAdapter: ProviderAdapter = {
  descriptor,
  async createMailbox() {
    return unsupported();
  },
  async listMessages() {
    return unsupported();
  },
  async getMessage() {
    return unsupported();
  },
};
