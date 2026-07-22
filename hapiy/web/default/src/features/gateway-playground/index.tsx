import '@xyflow/react/dist/style.css'

import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
  type XYPosition,
} from '@xyflow/react'
import { ArrowLeftRight, Boxes, FileEdit, Gauge, MessageCircleReply, Save, Workflow } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { AutoReplyNode } from './components/nodes/auto-reply-node'
import { ConcurrencyNode } from './components/nodes/concurrency-node'
import { EntryNode } from './components/nodes/entry-node'
import { ExitNode } from './components/nodes/exit-node'
import { ModifierNode } from './components/nodes/modifier-node'
import { ProviderNode } from './components/nodes/provider-node'
import { SwitchNode } from './components/nodes/switch-node'
import { createNodeData, initialEdges, initialNodes, type PlaygroundNodeData } from './mock/data'

const nodeTypes = {
  entry: EntryNode,
  exit: ExitNode,
  provider: ProviderNode,
  switch: SwitchNode,
  modifier: ModifierNode,
  concurrency: ConcurrencyNode,
  'auto-reply': AutoReplyNode,
}

const palette = [
  { type: 'entry', label: 'Entry', icon: Workflow },
  { type: 'exit', label: 'Exit', icon: Workflow },
  { type: 'provider', label: 'Provider', icon: Boxes },
  { type: 'switch', label: 'Auto-Switch', icon: ArrowLeftRight },
  { type: 'modifier', label: 'Request Modifier', icon: FileEdit },
  { type: 'concurrency', label: 'Concurrency', icon: Gauge },
  { type: 'auto-reply', label: 'Auto-Reply', icon: MessageCircleReply },
]

export function GatewayPlayground() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<PlaygroundNodeData>>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; flowPos: XYPosition } | null>(null)
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<Node<PlaygroundNodeData>, Edge> | null>(null)

  const onConnect = useCallback(
    (connection: Connection) => setEdges((current) => addEdge({ ...connection, animated: true }, current)),
    [setEdges]
  )

  const addNode = useCallback(
    (type: string, position?: XYPosition) => {
      const id = `${type}-${Date.now()}`
      const pos = position ?? { x: 220 + nodes.length * 20, y: 100 + (nodes.length % 5) * 100 }
      setNodes((current) => [...current, { id, type, position: pos, data: createNodeData(type) }])
    },
    [setNodes, nodes.length]
  )

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, _node: Node) => {
      if (!reactFlowInstance) return
      event.preventDefault()
      const flowPos = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setContextMenu({ x: event.clientX, y: event.clientY, flowPos })
    },
    [reactFlowInstance]
  )

  const onPaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      if (!reactFlowInstance) return
      event.preventDefault()
      const flowPos = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setContextMenu({ x: event.clientX, y: event.clientY, flowPos })
    },
    [reactFlowInstance]
  )

  const onPaneClick = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      if (event.detail !== 2) return
      if (!reactFlowInstance) return
      const flowPos = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setContextMenu({ x: event.clientX, y: event.clientY, flowPos })
    },
    [reactFlowInstance]
  )

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const handleContextMenuAdd = useCallback(
    (type: string) => {
      if (!contextMenu) return
      addNode(type, contextMenu.flowPos)
      closeContextMenu()
    },
    [contextMenu, addNode, closeContextMenu]
  )

  useEffect(() => {
    if (!contextMenu) return

    const handleClick = () => closeContextMenu()
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu()
    }

    // Small delay to avoid the same click closing the menu
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick)
      document.addEventListener('keydown', handleKeyDown)
    }, 0)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu, closeContextMenu])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Delete') {
        setNodes((current) => current.filter((node) => !node.selected))
      }
    },
    [setNodes]
  )

  const nodeTypesMemo = useMemo(() => nodeTypes, [])

  // Clamp context menu position so it doesn't overflow the viewport
  const menuStyle = useMemo(() => {
    if (!contextMenu) return undefined
    const menuWidth = 200
    const menuHeight = palette.length * 40 + 16
    const x = Math.min(contextMenu.x, window.innerWidth - menuWidth - 16)
    const y = Math.min(contextMenu.y, window.innerHeight - menuHeight - 16)
    return { left: x, top: y, position: 'fixed' as const, zIndex: 1000 }
  }, [contextMenu])

  return (
    <div className='flex h-[calc(100vh-3rem)] min-h-[650px] flex-col bg-muted/20' onKeyDown={onKeyDown} tabIndex={0}>
      <div className='flex items-center justify-between border-b bg-background px-5 py-3'>
        <div className='flex items-center gap-3'>
          <div>
            <h1 className='text-lg font-semibold'>Playground</h1>
            <p className='text-xs text-muted-foreground'>双击画布添加节点</p>
          </div>
        </div>
        <div className='flex gap-2'>
          <Button size='sm'>
            <Save className='mr-2 size-4' />保存并编译
          </Button>
        </div>
      </div>

      <div className='relative min-h-0 flex-1'>
        <ReactFlow<Node<PlaygroundNodeData>, Edge>
          nodes={nodes}
          edges={edges}
          onInit={setReactFlowInstance}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeContextMenu={onNodeContextMenu}
          onPaneContextMenu={onPaneContextMenu}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypesMemo}
          fitView
          zoomOnDoubleClick={false}
          deleteKeyCode='Delete'
          defaultEdgeOptions={{ animated: true, style: { strokeWidth: 2, opacity: 0.7 } }}
        >
          <Background gap={20} size={1} color='hsl(var(--muted-foreground) / 0.15)' />
          <Controls className='!rounded-xl !border !shadow-lg' />
          <MiniMap
            className='!h-20 !w-32 !rounded-lg !border-border/60 !bg-background/80 !shadow-sm backdrop-blur-sm'
            nodeColor={(node) => {
              const m: Record<string, string> = {
                entry: '#10b981', exit: '#f43f5e', provider: '#3b82f6', switch: '#f97316',
                modifier: '#8b5cf6', concurrency: '#eab308', 'auto-reply': '#06b6d4',
              }
              return m[node.type ?? ''] ?? '#6366f1'
            }}
            maskColor='hsl(var(--muted-foreground) / 0.05)'
          />
        </ReactFlow>

        {contextMenu && menuStyle && (
          <div
            style={menuStyle}
            className='w-48 rounded-xl border bg-background/95 p-3 shadow-xl backdrop-blur-md'
          >
            <p className='mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground'>添加节点</p>
            <div className='space-y-0.5'>
              {palette.map(({ type, label, icon: Icon }) => (
                <button
                  key={type}
                  type='button'
                  onClick={() => handleContextMenuAdd(type)}
                  className='flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-muted'
                >
                  <Icon className='size-4 text-muted-foreground' />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
