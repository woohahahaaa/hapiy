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

import type { GatewayProvider } from '../types'

export const MOCK_GATEWAY_PROVIDERS: GatewayProvider[] = [
  {
    id: 'prov-001', name: 'DeepSeek Official', type: 'openai', base_urls: 2, keys: 3, status: 'active',
    models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'],
    created_at: '2026-06-15',
  },
  {
    id: 'prov-002', name: 'OpenAI Compatible', type: 'openai', base_urls: 1, keys: 2, status: 'active',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'dall-e-3', 'whisper-1', 'text-embedding-3'],
    created_at: '2026-06-10',
  },
  {
    id: 'prov-003', name: 'Anthropic Gateway', type: 'anthropic', base_urls: 2, keys: 1, status: 'active',
    models: ['claude-sonnet', 'claude-opus', 'claude-haiku'],
    created_at: '2026-06-20',
  },
  {
    id: 'prov-004', name: 'Google Gateway', type: 'google', base_urls: 1, keys: 1, status: 'error',
    models: ['gemini-pro', 'gemini-ultra'],
    created_at: '2026-06-18',
  },
  {
    id: 'prov-005', name: 'Moonshot', type: 'openai', base_urls: 1, keys: 1, status: 'disabled',
    models: ['moonshot-v1', 'moonshot-v1-8k'],
    created_at: '2026-07-01',
  },
  {
    id: 'prov-006', name: '01.AI', type: 'openai', base_urls: 1, keys: 2, status: 'active',
    models: ['yi-large', 'yi-medium', 'yi-vision'],
    created_at: '2026-07-05',
  },
  {
    id: 'prov-007', name: 'Cohere', type: 'cohere', base_urls: 1, keys: 1, status: 'active',
    models: ['cohere-rerank', 'command-r'],
    created_at: '2026-07-08',
  },
]
