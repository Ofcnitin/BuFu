import type {
  Env,
  ProviderChapter,
  ProviderTitle,
  UnifiedPage,
} from '../types';

export type SourceAdapter = {
  id: string;
  name: string;
  role: 'reader' | 'metadata' | 'recommendation' | 'aggregator';

  // Explicit production gate. Only adapters with production=true participate
  // in orchestrator.ts's search/recommendations/chapters/pages fan-out.
  production: boolean;

  configured: (env: Env) => boolean;

  search?: (env: Env, q: string) => Promise<ProviderTitle[]>;
  getTitle?: (
    env: Env,
    sourceTitleId: string
  ) => Promise<ProviderTitle | null>;
  chapters?: (
    env: Env,
    sourceTitleId: string
  ) => Promise<ProviderChapter[]>;
  pages?: (
    env: Env,
    sourceTitleId: string,
    sourceChapterId: string
  ) => Promise<UnifiedPage[]>;
  recommendations?: (
    env: Env,
    category: string
  ) => Promise<ProviderTitle[]>;
  health?: (env: Env) => Promise<boolean>;
};

export const sourceList: SourceAdapter[] = [];

export const register = (adapter: SourceAdapter): void => {
  sourceList.push(adapter);
};

export const adapterById = (id: string): SourceAdapter | undefined =>
  sourceList.find((adapter) => adapter.id === id);

export const productionSources = (env: Env): SourceAdapter[] =>
  sourceList.filter(
    (adapter) => adapter.production && adapter.configured(env)
  );
