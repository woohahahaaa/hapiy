import { Handle, Position } from '@xyflow/react';

const models = [
  { id: 'gpt-4o',          label: 'GPT-4o',      provider: 'OpenAI' },
  { id: 'gpt-4o-mini',     label: 'GPT-4o-mini', provider: 'OpenAI, Azure' },
  { id: 'claude-sonnet',   label: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
  { id: 'deepseek-chat',   label: 'DeepSeek V3', provider: 'DeepSeek' },
  { id: 'gemini-pro',      label: 'Gemini Pro',  provider: 'Google' },
  { id: 'qwen-max',        label: 'Qwen Max',    provider: 'Alibaba' },
];

export default function ModelHubNode() {
  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      width: 220,
      fontFamily: 'var(--font-sans)',
      cursor: 'default',
      userSelect: 'none',
    }}>
      <Handle type="target" position={Position.Left} style={{ top: '50%', background: 'var(--sidebar-primary)', border: '2px solid var(--background)', width: 10, height: 10 }} />
      <Handle type="source" position={Position.Right} style={{ top: '50%', background: 'var(--sidebar-primary)', border: '2px solid var(--background)', width: 10, height: 10 }} />

      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>模型中心</div>
        <div style={{ fontSize: 10, color: 'var(--muted-foreground)', marginTop: 1 }}>Model Hub</div>
      </div>

      <div style={{ padding: '8px 10px 10px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {models.map((m) => (
          <div key={m.id} style={{
            fontSize: 11,
            padding: '3px 8px',
            borderRadius: 6,
            background: 'color-mix(in oklch, var(--sidebar-primary) 12%, var(--card))',
            color: 'var(--foreground)',
            border: '1px solid color-mix(in oklch, var(--sidebar-primary) 20%, var(--border))',
            lineHeight: 1.3,
          }}>
            {m.label}
          </div>
        ))}
      </div>

      <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--muted-foreground)' }}>
        6 models · 5 providers
      </div>
    </div>
  );
}
