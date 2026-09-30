// Personal mailbox providers are flagged and never treated as the company (PRD FR-2).
const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.de",
  "web.de",
  "yandex.com",
  "mail.com",
  "zoho.com",
  "qq.com",
  "163.com",
  "126.com",
  "naver.com",
  "hey.com",
  "fastmail.com",
  "pm.me",
  "mail.ru",
  "inbox.ru",
  "bk.ru",
  "list.ru",
  "t-online.de",
  "freenet.de",
  "orange.fr",
  "free.fr",
  "laposte.net",
  "sfr.fr",
  "libero.it",
  "virgilio.it",
  "btinternet.com",
  "comcast.net",
  "verizon.net",
  "att.net",
  "sbcglobal.net",
  "cox.net",
  "rediffmail.com",
  "seznam.cz",
  "wp.pl",
  "o2.pl",
  "interia.pl",
  "tutanota.com",
  "tuta.io",
]);

// Providers with a regional domain per country (yahoo.co.uk, hotmail.fr,
// outlook.de, gmx.net, yandex.ru): matched on the provider label, any suffix.
const PERSONAL_PROVIDER_LABELS = new Set([
  "yahoo",
  "ymail",
  "rocketmail",
  "hotmail",
  "outlook",
  "live",
  "gmx",
  "yandex",
]);

export function isPersonalDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  if (PERSONAL_DOMAINS.has(d)) return true;
  return PERSONAL_PROVIDER_LABELS.has(d.split(".")[0]);
}

// The TLD may hold digits and hyphens (punycode such as xn--p1ai) but needs
// at least one letter.
const EMAIL_SHAPE = /^[^\s@]+@([a-z0-9-]+\.)+(?=[a-z0-9-]*[a-z])[a-z0-9-]{2,}$/;

export class InvalidEmailError extends Error {}

export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!EMAIL_SHAPE.test(email)) {
    throw new InvalidEmailError(`Not a usable email address: ${raw}`);
  }
  return email;
}

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

export interface ResolvedIdentity {
  email: string;
  domain: string;
  personalDomain: boolean;
  accountDomain: string | null;
  name: string | null;
  companyName: string | null;
}

export function resolveIdentity(input: {
  email: string;
  name?: string | null;
  company?: string | null;
}): ResolvedIdentity {
  const email = normalizeEmail(input.email);
  const domain = emailDomain(email);
  const personalDomain = isPersonalDomain(domain);
  return {
    email,
    domain,
    personalDomain,
    accountDomain: personalDomain ? null : domain,
    name: input.name?.trim() || null,
    companyName: input.company?.trim() || null,
  };
}
