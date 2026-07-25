const initialNodes = [
  { id: 'ingress', type: 'ingress', position: { x: 10, y: 130 }, draggable: false },
  { id: 'egress',  type: 'egress',  position: { x: 580, y: 130 }, draggable: false },
  { id: 'hub',     type: 'modelHub',position: { x: 85, y: 105 },  draggable: false },
  { id: 'ch-openai',      type: 'channel',    position: { x: 310, y: 30 },   data: { label: 'OpenAI', provider: 'OpenAI', url: 'https://api.openai.com', latency: '230ms' } },
  { id: 'as-failover',    type: 'autoSwitch', position: { x: 310, y: 150 },  data: { label: '故障转移', slots: [{key:'主',provider:'Azure',baseURL:'https://xxx.openai.azure.com'},{key:'备1',provider:'DeepSeek',baseURL:'https://api.deepseek.com'},{key:'备2',provider:'Groq',baseURL:'https://api.groq.com'}] } },
  { id: 'ch-azure',       type: 'channel',    position: { x: 440, y: 95 },   data: { label: 'Azure OpenAI', provider: 'Azure', url: 'https://xxx.openai.azure.com', latency: '180ms' } },
  { id: 'ch-deepseek',    type: 'channel',    position: { x: 440, y: 200 },  data: { label: 'DeepSeek', provider: 'DeepSeek', url: 'https://api.deepseek.com', latency: '450ms' } },
  { id: 'ch-anthropic',   type: 'channel',    position: { x: 310, y: 310 },  data: { label: 'Anthropic', provider: 'Anthropic', url: 'https://api.anthropic.com', latency: '310ms' } },
];

const initialEdges = [
  { id: 'i-hub',       source: 'ingress',    target: 'hub',          animated: false },
  { id: 'hub-openai',  source: 'hub',        target: 'ch-openai',    animated: true  },
  { id: 'openai-eg',   source: 'ch-openai',  target: 'egress',       animated: true  },
  { id: 'hub-as',      source: 'hub',        target: 'as-failover',  animated: true  },
  { id: 'as-azure',    source: 'as-failover',target: 'ch-azure',     animated: true  },
  { id: 'as-deepseek', source: 'as-failover',target: 'ch-deepseek',  animated: true  },
  { id: 'azure-eg',    source: 'ch-azure',   target: 'egress',       animated: true  },
  { id: 'deepseek-eg', source: 'ch-deepseek',target: 'egress',       animated: true  },
  { id: 'hub-anth',    source: 'hub',        target: 'ch-anthropic', animated: true  },
  { id: 'anth-eg',     source: 'ch-anthropic',target: 'egress',      animated: true  },
];

export { initialNodes, initialEdges };
