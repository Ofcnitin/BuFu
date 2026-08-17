import type { Env, ProviderChapter, ProviderTitle, UnifiedPage } from '../types';

export type SourceAdapter = {
  id: string;
  name: string;
  role: 'reader' | 'metadata' | 'recommendation' | 'aggregator';
  // Explicit production gate. Only adapters with production=true participate
  // in orchestrator.ts's search/recommendations/chapters/pages fan-out. This
  // is enforced in code (not just by omission), so re-enabling a disabled
  // adapter always requires a deliberate, visible change in one place.
  production: boolean;
  configured: (env: Env) => boolean;
  search?: (env: Env, q: string) => Promise<ProviderTitle[]>;
  getTitle?: (env: Env, sourceTitleId: string) => Promise<ProviderTitle | null>;
  chapters?: (env: Env, sourceTitleId: string) => Promise<ProviderChapter[]>;
  pages?: (env: Env, sourceTitleId: string, sourceChapterId: string) => Promise<UnifiedPage[]>;
  recommendations?: (env: Env, category: string) => Promise<ProviderTitle[]>;
  health?: (env: Env) => Promise<boolean>;
};

export const sourceList: SourceAdapter[] = [];
export const register = (adapter: SourceAdapter) => sourceList.push(adapter);
export const adapterById = (id: string) => sourceList.find(a => a.id === id);
export const productionSources = (env: Env) => sourceList.filter(a => a.production && a.configured(env));
