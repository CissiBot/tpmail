import { MailboxSession } from "@/lib/tpmail/types";

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

type StoreShape = {
  mailboxes: Map<string, MailboxSession>;
  cache: Map<string, CacheEntry>;
};

declare global {
  var __tpmailStore__: StoreShape | undefined;
}

function getStore() {
  if (!globalThis.__tpmailStore__) {
    globalThis.__tpmailStore__ = {
      mailboxes: new Map<string, MailboxSession>(),
      cache: new Map<string, CacheEntry>(),
    };
  }

  return globalThis.__tpmailStore__;
}

export function saveMailbox(mailbox: MailboxSession) {
  purgeExpiredMailboxes();
  getStore().mailboxes.set(mailbox.id, mailbox);
}

export function readMailbox(mailboxId: string) {
  purgeExpiredMailboxes();
  return getStore().mailboxes.get(mailboxId) ?? null;
}

export function deleteMailbox(mailboxId: string) {
  getStore().mailboxes.delete(mailboxId);
}

export function purgeExpiredMailboxes() {
  const now = Date.now();
  for (const [mailboxId, mailbox] of getStore().mailboxes.entries()) {
    if (mailbox.expiresAt && new Date(mailbox.expiresAt).getTime() <= now) {
      getStore().mailboxes.delete(mailboxId);
    }
  }
}

export function readCache<T>(key: string) {
  const entry = getStore().cache.get(key);
  if (!entry) {
    return null;
  }

  if (Date.now() > entry.expiresAt) {
    getStore().cache.delete(key);
    return null;
  }

  return entry.value as T;
}

export function writeCache<T>(key: string, value: T, ttlMs: number) {
  getStore().cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}
