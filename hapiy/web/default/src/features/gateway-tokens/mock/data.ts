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

import type { GatewayToken } from '../types'

export const MOCK_GATEWAY_TOKENS: GatewayToken[] = [
  {
    id: 'tok-001', name: 'agent-main', value: 'sk-gw-agent-main-xxxxx1',
    requests: 12400, status: 'active', groups: ['default', 'production'],
    created_at: '2026-06-01', last_used: '2026-07-22 14:32:10',
  },
  {
    id: 'tok-002', name: 'openclaw-local', value: 'sk-gw-openclaw-xxxxx2',
    requests: 8921, status: 'active', groups: ['default'],
    created_at: '2026-06-05', last_used: '2026-07-22 14:28:00',
  },
  {
    id: 'tok-003', name: 'batch-worker', value: 'sk-gw-batch-xxxxx3',
    requests: 5600, status: 'active', groups: ['batch', 'default'],
    created_at: '2026-06-10', last_used: '2026-07-22 13:45:00',
  },
  {
    id: 'tok-004', name: 'image-gen', value: 'sk-gw-image-xxxxx4',
    requests: 1230, status: 'active', groups: ['media'],
    created_at: '2026-06-15', last_used: '2026-07-22 14:00:00',
  },
  {
    id: 'tok-005', name: 'media-worker', value: 'sk-gw-media-xxxxx5',
    requests: 3400, status: 'active', groups: ['media'],
    created_at: '2026-06-20', last_used: '2026-07-22 13:25:00',
  },
  {
    id: 'tok-006', name: 'voice-agent', value: 'sk-gw-voice-xxxxx6',
    requests: 890, status: 'active', groups: ['realtime'],
    created_at: '2026-07-01', last_used: '2026-07-22 13:05:00',
  },
  {
    id: 'tok-007', name: 'search-worker', value: 'sk-gw-search-xxxxx7',
    requests: 2100, status: 'active', groups: ['search'],
    created_at: '2026-07-02', last_used: '2026-07-22 13:15:00',
  },
  {
    id: 'tok-008', name: 'test-token', value: 'sk-gw-test-xxxxx8',
    requests: 450, status: 'expired', groups: ['test'],
    created_at: '2026-06-01', last_used: '2026-07-20 10:00:00',
  },
  {
    id: 'tok-009', name: 'expired-key', value: 'sk-gw-expired-xxxxx9',
    requests: 120, status: 'disabled', groups: ['default'],
    created_at: '2026-05-15', last_used: '2026-07-10 08:30:00',
  },
]
