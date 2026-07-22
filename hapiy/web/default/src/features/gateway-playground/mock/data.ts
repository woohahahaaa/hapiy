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
import type { Edge, Node } from '@xyflow/react'

export type PlaygroundNodeData = {
  label: string
  detail: string
  providerName?: string
  baseUrlCount?: number
  keyCount?: number
  ruleName?: string
  limit?: number
}

export type PlaygroundNode = Node<PlaygroundNodeData>

export type PlaygroundEdge = Edge

export type PaletteItem = {
  type: string
  label: string
  color: string
}

export const PALETTE_ITEMS: PaletteItem[] = [
  { type: 'entry', label: 'Entry', color: 'green' },
  { type: 'exit', label: 'Exit', color: 'red' },
  { type: 'provider', label: 'Provider', color: 'blue' },
  { type: 'switch', label: 'Auto-Switch', color: 'orange' },
  { type: 'modifier', label: 'Request Modifier', color: 'purple' },
  { type: 'concurrency', label: 'Concurrency', color: 'yellow' },
  { type: 'auto-reply', label: 'Auto-Reply', color: 'cyan' },
]

export const initialNodes: PlaygroundNode[] = [
  {
    id: 'entry-1',
    type: 'entry',
    position: { x: 0, y: 200 },
    data: { label: 'Entry', detail: 'API entry point' },
  },
  {
    id: 'provider-1',
    type: 'provider',
    position: { x: 300, y: 200 },
    data: {
      label: 'Provider',
      detail: 'DeepSeek Official',
      providerName: 'DeepSeek Official',
      baseUrlCount: 2,
      keyCount: 3,
    },
  },
  {
    id: 'switch-1',
    type: 'switch',
    position: { x: 620, y: 200 },
    data: {
      label: 'Auto-Switch',
      detail: 'Default Switch Rules',
      ruleName: 'Default Switch Rules',
    },
  },
  {
    id: 'exit-1',
    type: 'exit',
    position: { x: 940, y: 200 },
    data: { label: 'Exit', detail: 'API exit point' },
  },
]

export const initialEdges: PlaygroundEdge[] = [
  { id: 'e-entry-1-provider-1', source: 'entry-1', target: 'provider-1' },
  { id: 'e-provider-1-switch-1', source: 'provider-1', target: 'switch-1' },
  { id: 'e-switch-1-exit-1', source: 'switch-1', target: 'exit-1' },
]

const PALETTE_BORDER_COLORS: Record<string, string> = {
  green: 'border-l-green-500',
  red: 'border-l-red-500',
  blue: 'border-l-blue-500',
  orange: 'border-l-orange-500',
  purple: 'border-l-purple-500',
  yellow: 'border-l-yellow-500',
  cyan: 'border-l-cyan-500',
}

const PALETTE_ICON_COLORS: Record<string, string> = {
  green: 'text-green-500',
  red: 'text-red-500',
  blue: 'text-blue-500',
  orange: 'text-orange-500',
  purple: 'text-purple-500',
  yellow: 'text-yellow-500',
  cyan: 'text-cyan-500',
}

const PALETTE_HANDLE_COLORS: Record<string, string> = {
  green: '!bg-green-500',
  red: '!bg-red-500',
  blue: '!bg-blue-500',
  orange: '!bg-orange-500',
  purple: '!bg-purple-500',
  yellow: '!bg-yellow-500',
  cyan: '!bg-cyan-500',
}

export function getNodeBorderColor(color: string): string {
  return PALETTE_BORDER_COLORS[color] ?? 'border-l-muted-foreground'
}

export function getNodeIconColor(color: string): string {
  return PALETTE_ICON_COLORS[color] ?? 'text-muted-foreground'
}

export function getNodeHandleColor(color: string): string {
  return PALETTE_HANDLE_COLORS[color] ?? '!bg-muted-foreground'
}

export function createNodeData(nodeType: string): PlaygroundNodeData {
  switch (nodeType) {
    case 'entry':
      return { label: 'Entry', detail: 'API entry point' }
    case 'exit':
      return { label: 'Exit', detail: 'API exit point' }
    case 'provider':
      return {
        label: 'Provider',
        detail: 'New Provider',
        providerName: 'New Provider',
        baseUrlCount: 0,
        keyCount: 0,
      }
    case 'switch':
      return {
        label: 'Auto-Switch',
        detail: 'Switch rules',
        ruleName: 'New Switch Rule',
      }
    case 'modifier':
      return {
        label: 'Request Modifier',
        detail: 'Modifier rules',
        ruleName: 'New Modifier Rule',
      }
    case 'concurrency':
      return {
        label: 'Concurrency',
        detail: 'Rate limiting',
        limit: 10,
      }
    case 'auto-reply':
      return {
        label: 'Auto-Reply',
        detail: 'Auto-reply rules',
        ruleName: 'New Auto-Reply Rule',
      }
    default:
      return { label: 'Node', detail: '' }
  }
}
