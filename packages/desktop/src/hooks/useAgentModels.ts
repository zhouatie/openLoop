import { useEffect, useState } from 'react';
import { api } from '../services/api';

export interface AgentModelItem {
  id: string;
  label: string;
  provider?: string;
}

let cachedModels: AgentModelItem[] = [];
let fetchPromise: Promise<AgentModelItem[]> | null = null;
const listeners = new Set<(models: AgentModelItem[]) => void>();

function notify(models: AgentModelItem[]) {
  cachedModels = models;
  for (const listener of listeners) {
    listener(models);
  }
}

export function fetchGlobalAgentModels(): Promise<AgentModelItem[]> {
  if (fetchPromise) return fetchPromise;
  if (import.meta.env?.DEV) console.log('[useAgentModels] 请求全局可用模型列表');
  fetchPromise = api
    .getAgentModels()
    .then((data) => {
      const list = (data.models || []).map((item) => ({
        id: `${item.provider}/${item.id}`,
        label: item.label || `${item.provider}/${item.id}`,
        provider: item.provider,
      }));
      if (import.meta.env?.DEV) console.log('[useAgentModels] 全局模型列表就绪:', list.length);
      notify(list);
      return list;
    })
    .catch((err) => {
      if (import.meta.env?.DEV) console.warn('[useAgentModels] 获取全局模型失败:', err);
      return cachedModels;
    })
    .finally(() => {
      fetchPromise = null;
    });
  return fetchPromise;
}

export function useAgentModels() {
  const [models, setModels] = useState<AgentModelItem[]>(cachedModels);

  useEffect(() => {
    listeners.add(setModels);
    if (cachedModels.length === 0) {
      void fetchGlobalAgentModels();
    }
    return () => {
      listeners.delete(setModels);
    };
  }, []);

  return { models, refresh: fetchGlobalAgentModels };
}
