import { createContext, useContext, useState, useCallback } from 'react';

const SEED = [
  { id: 1, name: 'Open Code Go', status: true,  baseUrls: ['https://api.opencode.ai'], keys: ['sk-ocg-xxx'], endpoints: ['/v1/chat/completions'], models: [{ model: 'gpt-4o', endpoint: '/v1/chat/completions', discount: '' }, { model: 'claude-sonnet', endpoint: '/v1/chat/completions', discount: '0.90' }] },
  { id: 2, name: '字节跳动',     status: true,  baseUrls: ['https://ark.cn-beijing.volces.com/api/v3'], keys: ['sk-bytedance-xxx'], endpoints: ['/v1/chat/completions'], models: [{ model: 'doubao-pro', endpoint: '/v1/chat/completions', discount: '0.85' }, { model: 'doubao-lite', endpoint: '/v1/chat/completions', discount: '0.85' }] },
  { id: 3, name: '阿里百炼',     status: false, baseUrls: ['https://dashscope.aliyuncs.com/compatible-mode/v1'], keys: ['sk-bailian-xxx'], endpoints: ['/v1/chat/completions'], models: [{ model: 'qwen-max', endpoint: '/v1/chat/completions', discount: '' }, { model: 'qwen-plus', endpoint: '/v1/chat/completions', discount: '' }, { model: 'qwen-turbo', endpoint: '/v1/chat/completions', discount: '0.70' }] },
  { id: 4, name: '腾讯混元',     status: true,  baseUrls: ['https://api.hunyuan.cloud.tencent.com/v1'], keys: ['sk-hunyuan-xxx'], endpoints: ['/v1/chat/completions'], models: [{ model: 'hunyuan-pro', endpoint: '/v1/chat/completions', discount: '' }, { model: 'hunyuan-lite', endpoint: '/v1/chat/completions', discount: '0.80' }] },
  { id: 5, name: '智谱 AI',      status: true,  baseUrls: ['https://open.bigmodel.cn/api/paas/v4'], keys: ['sk-zhipu-xxx'], endpoints: ['/v1/chat/completions'], models: [{ model: 'glm-4', endpoint: '/v1/chat/completions', discount: '0.95' }, { model: 'glm-4v', endpoint: '/v1/chat/completions', discount: '' }] },
];

const ProviderContext = createContext(null);

export function ProviderStore({ children }) {
  const [providers, setProviders] = useState(SEED);
  const [version, setVersion] = useState(0);

  const saveProvider = useCallback((next) => {
    setProviders((ps) => {
      const idx = ps.findIndex((p) => p.id === next.id);
      if (idx >= 0) {
        const updated = [...ps];
        updated[idx] = next;
        return updated;
      }
      const id = next.id || Math.max(0, ...ps.map((p) => p.id)) + 1;
      return [...ps, { ...next, id }];
    });
    setVersion((v) => v + 1);
  }, []);

  const deleteProvider = useCallback((id) => {
    setProviders((ps) => ps.filter((p) => p.id !== id));
    setVersion((v) => v + 1);
  }, []);

  const toggleProvider = useCallback((id) => {
    setProviders((ps) => ps.map((p) => (p.id === id ? { ...p, status: !p.status } : p)));
    setVersion((v) => v + 1);
  }, []);

  const importProviders = useCallback((all) => {
    setProviders(all);
    setVersion((v) => v + 1);
  }, []);

  return (
    <ProviderContext.Provider value={{ providers, version, saveProvider, deleteProvider, toggleProvider, importProviders }}>
      {children}
    </ProviderContext.Provider>
  );
}

export function useProviders() {
  const ctx = useContext(ProviderContext);
  if (!ctx) throw new Error('useProviders must be used within ProviderStore');
  return ctx;
}

export function getModelsUnion(providers) {
  const seen = new Map();
  for (const p of providers) {
    for (const m of p.models || []) {
      if (!m.model) continue;
      const existing = seen.get(m.model);
      if (!existing || (existing.disabled && p.status)) {
        seen.set(m.model, { id: m.model, label: m.model, disabled: !p.status });
      }
    }
  }
  return [...seen.values()];
}

export function generateProviderEdges(providers) {
  const edges = [];
  for (const p of providers) {
    for (const m of p.models || []) {
      if (!m.model) continue;
      edges.push({
        id: `${m.model}->ch-${p.id}`,
        source: 'hub',
        sourceHandle: m.model,
        target: `ch-${p.id}`,
        targetHandle: m.model,
        animated: p.status,
        className: p.status ? undefined : 'edge-inactive',
      });
    }
  }
  return edges;
}

export function makeChannelNodes(providers) {
  return providers.map((p, i) => ({
    id: `ch-${p.id}`,
    type: 'channel',
    position: { x: 350, y: 30 + i * 180 },
    data: {
      label: p.name,
      baseURLCount: (p.baseUrls || []).length,
      keyCount: (p.keys || []).length,
      modelCount: (p.models || []).length,
      active: p.status,
    },
  }));
}
