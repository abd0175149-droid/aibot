export * from './types.js';
export * from './google.js';
export * from './pricing.js';

import { GoogleProvider } from './google.js';
import type { AiProvider } from './types.js';

const PROVIDERS = new Map<string, AiProvider>([['google', new GoogleProvider()]]);

export function getProvider(name: string): AiProvider {
  const p = PROVIDERS.get(name);
  if (!p) throw new Error(`لا مزوّد باسم ${name}`);
  return p;
}

/** النماذج الافتراضيّة — تُضبط من البيئة فتبديلها لا يحتاج نشراً. */
export const DEFAULT_CHAT_MODEL = process.env.CHAT_MODEL ?? 'gemini-2.5-flash';
export const DEFAULT_EMBED_MODEL = process.env.EMBED_MODEL ?? 'gemini-embedding-001';
export const EMBED_DIMS = 768;
