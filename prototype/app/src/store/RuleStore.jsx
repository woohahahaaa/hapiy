import { createContext, useContext, useState, useCallback } from 'react';

const SEED = {
  heartbeat: [
    { id: 1, name: '默认心跳', scope: 'all', window: 60, minTokens: 3, interval: 15, firstTokenTimeout: 0, onDisconnect: true, streamMarker: '\u200B', disconnectMessage: '请求断开', status: true },
    { id: 2, name: '低速流式中断', scope: 'all', window: 30, minTokens: 1, interval: 10, firstTokenTimeout: 5, onDisconnect: true, streamMarker: '\u200B', disconnectMessage: '请求断开', status: true },
  ],
  failover: [
    { id: 1, name: '主备切换', primary: 'Open Code Go', fallback: '字节跳动', condition: 'timeout', status: true },
    { id: 2, name: '限流切换', primary: '字节跳动', fallback: '阿里百炼', condition: 'rate_limit', status: false },
  ],
  concurrency: [
    { id: 1, name: '全局限流', scope: 'global', maxConcurrent: 100, queueEnabled: true, status: true },
    { id: 2, name: '用户限流', scope: 'per_user', maxConcurrent: 10, queueEnabled: false, status: true },
    { id: 3, name: '令牌限流', scope: 'per_token', maxConcurrent: 50, queueEnabled: true, status: true },
  ],
  rewrite: [
    {
      id: 1,
      name: '模型统一替换',
      status: true,
      script: `# 将所有请求的模型统一替换
SET model = "gpt-4o"
SET max_tokens = 4096`
    },
    {
      id: 2,
      name: '条件路由 + 清理参数',
      status: true,
      script: `# 根据原始模型做条件替换
IF model == "gpt-3.5-turbo" THEN SET model = "gpt-4o-mini"
IF model ~ "claude-*" THEN { SET model = "claude-sonnet"; SET max_tokens = 8192 }

# 移除不需要的参数
DELETE top_p
DELETE frequency_penalty
DELETE presence_penalty
DELETE logit_bias`
    },
    {
      id: 3,
      name: '注入请求头',
      status: false,
      script: `# 为所有请求注入自定义 Header
SET header.X-Gateway = "hapiy"
SET header.X-Request-Id = "{{request_id}}"
DELETE header.X-Forwarded-For`
    },
  ],
};

const RuleContext = createContext(null);

export function RuleStore({ children }) {
  const [rules, setRules] = useState(SEED);
  const [version, setVersion] = useState(0);

  const saveRule = useCallback((type, next) => {
    setRules((rs) => {
      const list = [...(rs[type] || [])];
      const idx = list.findIndex((r) => r.id === next.id);
      if (idx >= 0) {
        list[idx] = next;
      } else {
        const id = next.id || Math.max(0, ...list.map((r) => r.id)) + 1;
        list.push({ ...next, id });
      }
      return { ...rs, [type]: list };
    });
    setVersion((v) => v + 1);
  }, []);

  const deleteRule = useCallback((type, id) => {
    setRules((rs) => {
      const list = (rs[type] || []).filter((r) => r.id !== id);
      return { ...rs, [type]: list };
    });
    setVersion((v) => v + 1);
  }, []);

  const toggleRule = useCallback((type, id) => {
    setRules((rs) => {
      const list = (rs[type] || []).map((r) => (r.id === id ? { ...r, status: !r.status } : r));
      return { ...rs, [type]: list };
    });
    setVersion((v) => v + 1);
  }, []);

  const importRules = useCallback((all) => {
    setRules(all);
    setVersion((v) => v + 1);
  }, []);

  return (
    <RuleContext.Provider value={{ rules, version, saveRule, deleteRule, toggleRule, importRules }}>
      {children}
    </RuleContext.Provider>
  );
}

export function useRules() {
  const ctx = useContext(RuleContext);
  if (!ctx) throw new Error('useRules must be used within RuleStore');
  return ctx;
}
