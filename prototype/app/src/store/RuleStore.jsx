import { createContext, useContext, useState, useCallback } from 'react';

const SEED = {
  heartbeat: [
    { id: 1, name: '默认心跳', pattern: '*', response: '服务暂时不可用，请稍后重试', timeout: 30, status: true },
    { id: 2, name: '流式中断', pattern: 'stream_timeout', response: '响应流中断，正在重连...', timeout: 15, status: true },
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
    { id: 1, name: '模型替换', field: 'model', action: '替换', value: 'gpt-4o', status: true },
    { id: 2, name: 'Token 上限', field: 'max_tokens', action: '替换', value: '4096', status: true },
    { id: 3, name: '注入 Header', field: 'headers', action: '添加', value: 'X-Forwarded-By: hapiy', status: false },
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
