/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import type { GatewayLogEntry } from '../types'

export const MOCK_GATEWAY_LOGS: GatewayLogEntry[] = [
  { id: 'log-001', method: 'POST', path: '/v1/chat/completions', model: 'deepseek-chat', status: 200, duration: 2.4, tokens: 1250, cost: '$0.025', timestamp: '2026-07-22 14:32:10', provider: 'DeepSeek Official', token_name: 'agent-main', ip: '192.168.1.100' },
  { id: 'log-002', method: 'POST', path: '/v1/chat/completions', model: 'claude-sonnet', status: 200, duration: 8.1, tokens: 3400, cost: '$0.102', timestamp: '2026-07-22 14:30:05', provider: 'Anthropic Gateway', token_name: 'agent-main', ip: '192.168.1.100' },
  { id: 'log-003', method: 'GET', path: '/v1/models', model: 'system', status: 200, duration: 0.12, tokens: 0, cost: '$0.000', timestamp: '2026-07-22 14:28:00', provider: 'System', token_name: 'openclaw-local', ip: '10.0.0.5' },
  { id: 'log-004', method: 'POST', path: '/v1/responses', model: 'gpt-4o', status: 200, duration: 4.8, tokens: 2100, cost: '$0.063', timestamp: '2026-07-22 14:25:30', provider: 'OpenAI Compatible', token_name: 'agent-main', ip: '192.168.1.100' },
  { id: 'log-005', method: 'POST', path: '/v1/chat/completions', model: 'deepseek-chat', status: 429, duration: 0.5, tokens: 0, cost: '$0.000', timestamp: '2026-07-22 14:20:15', provider: 'DeepSeek Official', token_name: 'test-token', ip: '10.0.0.8' },
  { id: 'log-006', method: 'POST', path: '/v1/embeddings', model: 'text-embedding-3', status: 200, duration: 1.2, tokens: 800, cost: '$0.004', timestamp: '2026-07-22 14:15:00', provider: 'OpenAI Compatible', token_name: 'batch-worker', ip: '192.168.1.50' },
  { id: 'log-007', method: 'POST', path: '/v1/chat/completions', model: 'gemini-pro', status: 502, duration: 15.0, tokens: 0, cost: '$0.000', timestamp: '2026-07-22 14:10:45', provider: 'Google Gateway', token_name: 'openclaw-local', ip: '10.0.0.5' },
  { id: 'log-008', method: 'POST', path: '/v1/chat/completions', model: 'claude-sonnet', status: 200, duration: 6.3, tokens: 2800, cost: '$0.084', timestamp: '2026-07-22 14:05:20', provider: 'Anthropic Gateway', token_name: 'agent-main', ip: '192.168.1.100' },
  { id: 'log-009', method: 'POST', path: '/v1/images/generations', model: 'dall-e-3', status: 200, duration: 12.5, tokens: 0, cost: '$0.040', timestamp: '2026-07-22 14:00:00', provider: 'OpenAI Compatible', token_name: 'image-gen', ip: '192.168.1.120' },
  { id: 'log-010', method: 'POST', path: '/v1/chat/completions', model: 'deepseek-chat', status: 401, duration: 0.3, tokens: 0, cost: '$0.000', timestamp: '2026-07-22 13:55:30', provider: 'DeepSeek Official', token_name: 'expired-key', ip: '10.0.0.8' },
  { id: 'log-011', method: 'POST', path: '/v1/chat/completions', model: 'yi-large', status: 200, duration: 3.1, tokens: 1560, cost: '$0.031', timestamp: '2026-07-22 13:50:10', provider: '01.AI', token_name: 'agent-main', ip: '192.168.1.100' },
  { id: 'log-012', method: 'POST', path: '/v1/responses', model: 'gpt-4o-mini', status: 200, duration: 2.0, tokens: 980, cost: '$0.010', timestamp: '2026-07-22 13:45:00', provider: 'OpenAI Compatible', token_name: 'batch-worker', ip: '192.168.1.50' },
  { id: 'log-013', method: 'GET', path: '/v1/chat/completions', model: 'moonshot-v1', status: 504, duration: 30.0, tokens: 0, cost: '$0.000', timestamp: '2026-07-22 13:40:00', provider: 'Moonshot', token_name: 'openclaw-local', ip: '10.0.0.5' },
  { id: 'log-014', method: 'POST', path: '/v1/chat/completions', model: 'deepseek-chat', status: 200, duration: 1.8, tokens: 890, cost: '$0.018', timestamp: '2026-07-22 13:35:20', provider: 'DeepSeek Official', token_name: 'agent-main', ip: '192.168.1.100' },
  { id: 'log-015', method: 'POST', path: '/v1/chat/completions', model: 'claude-sonnet', status: 200, duration: 7.2, tokens: 3100, cost: '$0.093', timestamp: '2026-07-22 13:30:00', provider: 'Anthropic Gateway', token_name: 'agent-main', ip: '192.168.1.100' },
  { id: 'log-016', method: 'POST', path: '/v1/audio/transcriptions', model: 'whisper-1', status: 200, duration: 5.5, tokens: 0, cost: '$0.006', timestamp: '2026-07-22 13:25:00', provider: 'OpenAI Compatible', token_name: 'media-worker', ip: '192.168.1.80' },
  { id: 'log-017', method: 'POST', path: '/v1/chat/completions', model: 'deepseek-chat', status: 200, duration: 2.2, tokens: 1100, cost: '$0.022', timestamp: '2026-07-22 13:20:00', provider: 'DeepSeek Official', token_name: 'agent-main', ip: '192.168.1.100' },
  { id: 'log-018', method: 'POST', path: '/v1/rerank', model: 'cohere-rerank', status: 200, duration: 0.9, tokens: 0, cost: '$0.002', timestamp: '2026-07-22 13:15:00', provider: 'Cohere', token_name: 'search-worker', ip: '192.168.1.90' },
  { id: 'log-019', method: 'POST', path: '/v1/chat/completions', model: 'deepseek-chat', status: 200, duration: 3.5, tokens: 1800, cost: '$0.036', timestamp: '2026-07-22 13:10:00', provider: 'DeepSeek Official', token_name: 'agent-main', ip: '192.168.1.100' },
  { id: 'log-020', method: 'POST', path: '/v1/realtime', model: 'gpt-4o-realtime', status: 200, duration: 45.0, tokens: 5000, cost: '$0.200', timestamp: '2026-07-22 13:05:00', provider: 'OpenAI Compatible', token_name: 'voice-agent', ip: '192.168.1.110' },
]
