// Demo topology replicating the LiteGraph prototype
// 2 Endpoints → 2 Routes → 3 Channels + 1 AutoSwitch

const initialNodes = [
  {
    id: 'ep1',
    type: 'endpoint',
    position: { x: 50, y: 80 },
    data: { label: 'GPT 入口', model: 'gpt-4o / gpt-4o-mini', status: 'active' },
  },
  {
    id: 'ep2',
    type: 'endpoint',
    position: { x: 50, y: 320 },
    data: { label: 'Claude 入口', model: 'claude-3.5-sonnet', status: 'active' },
  },
  {
    id: 'route1',
    type: 'route',
    position: { x: 340, y: 50 },
    data: { label: '优先路由', rule: "model contains 'gpt-4o'", priority: 1 },
  },
  {
    id: 'route2',
    type: 'route',
    position: { x: 340, y: 300 },
    data: { label: 'Claude 路由', rule: "model contains 'claude'", priority: 2 },
  },
  {
    id: 'ch1',
    type: 'channel',
    position: { x: 630, y: 20 },
    data: { label: 'OpenAI 官方', provider: 'OpenAI', url: 'https://api.openai.com', latency: '230ms' },
  },
  {
    id: 'ch2',
    type: 'channel',
    position: { x: 630, y: 130 },
    data: { label: 'Azure OpenAI', provider: 'Azure', url: 'https://xxx.openai.azure.com', latency: '180ms' },
  },
  {
    id: 'ch3',
    type: 'channel',
    position: { x: 630, y: 310 },
    data: { label: 'Anthropic', provider: 'Anthropic', url: 'https://api.anthropic.com', latency: '310ms' },
  },
  {
    id: 'as1',
    type: 'autoSwitch',
    position: { x: 340, y: 160 },
    data: {
      label: '自动切换',
      slots: [
        { key: '主', provider: 'OpenAI', baseURL: 'https://api.openai.com' },
        { key: '备1', provider: 'DeepSeek', baseURL: 'https://api.deepseek.com' },
        { key: '备2', provider: 'Groq', baseURL: 'https://api.groq.com' },
      ],
    },
  },
  {
    id: 'ar1',
    type: 'autoReply',
    position: { x: 630, y: 430 },
    data: { label: '自动回复', timeout: '30s', message: '上游正在处理，请稍候...' },
  },
];

const initialEdges = [
  // ep1 → route1
  { id: 'e1-r1', source: 'ep1', target: 'route1' },
  // route1 → ch1
  { id: 'r1-c1', source: 'route1', target: 'ch1' },
  // route1 → ch2
  { id: 'r1-c2', source: 'route1', target: 'ch2' },
  // route1 → autoSwitch (attached but separate branch)
  { id: 'r1-as1', source: 'route1', target: 'as1' },
  // ep2 → route2
  { id: 'e2-r2', source: 'ep2', target: 'route2' },
  // route2 → ch3
  { id: 'r2-c3', source: 'route2', target: 'ch3' },
  // AutoReply is intentionally unconnected (placeholder)
];

export { initialNodes, initialEdges };
