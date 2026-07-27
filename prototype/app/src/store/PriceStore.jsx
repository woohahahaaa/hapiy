import { createContext, useContext, useState, useCallback } from 'react';

const SEED = [
  { id: 1, model: 'gpt-4o', input: '0.0025', output: '0.0100', cacheWrite: '0.00375', cacheRead: '0.00075' },
  { id: 2, model: 'claude-sonnet', input: '0.0030', output: '0.0150', cacheWrite: '0.00375', cacheRead: '0.00030' },
  { id: 3, model: 'doubao-pro', input: '0.0008', output: '0.0020', cacheWrite: '0.0012', cacheRead: '0.0004' },
  { id: 4, model: 'doubao-lite', input: '0.0004', output: '0.0010', cacheWrite: '0.0006', cacheRead: '0.0002' },
  { id: 5, model: 'qwen-max', input: '0.0050', output: '0.0200', cacheWrite: '0.0075', cacheRead: '0.0015' },
  { id: 6, model: 'qwen-plus', input: '0.0020', output: '0.0080', cacheWrite: '0.0030', cacheRead: '0.0006' },
  { id: 7, model: 'qwen-turbo', input: '0.0008', output: '0.0020', cacheWrite: '0.0012', cacheRead: '0.0004' },
  { id: 8, model: 'hunyuan-pro', input: '0.0040', output: '0.0120', cacheWrite: '0.0060', cacheRead: '0.0012' },
  { id: 9, model: 'hunyuan-lite', input: '0.0010', output: '0.0030', cacheWrite: '0.0015', cacheRead: '0.0003' },
  { id: 10, model: 'glm-4', input: '0.0015', output: '0.0060', cacheWrite: '0.00225', cacheRead: '0.00045' },
  { id: 11, model: 'glm-4v', input: '0.0030', output: '0.0100', cacheWrite: '0.0045', cacheRead: '0.0009' },
];

const PriceContext = createContext(null);

export function PriceStore({ children }) {
  const [prices, setPrices] = useState(SEED);
  const [version, setVersion] = useState(0);

  const savePrice = useCallback((next) => {
    setPrices((ps) => {
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

  const deletePrice = useCallback((id) => {
    setPrices((ps) => ps.filter((p) => p.id !== id));
    setVersion((v) => v + 1);
  }, []);

  const importPrices = useCallback((all) => {
    setPrices(all);
    setVersion((v) => v + 1);
  }, []);

  return (
    <PriceContext.Provider value={{ prices, version, savePrice, deletePrice, importPrices }}>
      {children}
    </PriceContext.Provider>
  );
}

export function usePrices() {
  const ctx = useContext(PriceContext);
  if (!ctx) throw new Error('usePrices must be used within PriceStore');
  return ctx;
}
