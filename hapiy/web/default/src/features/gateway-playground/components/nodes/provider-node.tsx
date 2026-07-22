import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Boxes, Globe, Key } from 'lucide-react'

import type { PlaygroundNode } from '../../mock/data'

export function ProviderNode({ selected, data }: NodeProps<PlaygroundNode>) {
  return (
    <div
      className={`relative w-[260px] rounded-2xl border-2 bg-gradient-to-br from-blue-500/10 to-blue-500/5 p-4 shadow-lg backdrop-blur-sm transition-shadow hover:shadow-blue-500/20 ${
        selected ? 'border-blue-400 shadow-blue-500/30' : 'border-blue-500/30'
      }`}
    >
      <Handle type='target' position={Position.Left} className='!h-3 !w-3 !border-[3px] !border-background !bg-blue-500' />
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-3'>
          <div className='flex size-9 items-center justify-center rounded-xl bg-blue-500/20'>
            <Boxes className='size-5 text-blue-500' />
          </div>
          <div>
            <p className='text-sm font-semibold'>{data.label}</p>
            <p className='text-xs text-muted-foreground'>{data.detail}</p>
          </div>
        </div>
        <span className='size-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50' />
      </div>
      <div className='mt-3 flex gap-3'>
        <div className='flex items-center gap-1.5 rounded-lg bg-muted/50 px-2.5 py-1.5'>
          <Globe className='size-3.5 text-muted-foreground' />
          <span className='text-xs font-medium'>{data.baseUrlCount ?? 0} URLs</span>
        </div>
        <div className='flex items-center gap-1.5 rounded-lg bg-muted/50 px-2.5 py-1.5'>
          <Key className='size-3.5 text-muted-foreground' />
          <span className='text-xs font-medium'>{data.keyCount ?? 0} Keys</span>
        </div>
      </div>
      <Handle type='source' position={Position.Right} className='!h-3 !w-3 !border-[3px] !border-background !bg-blue-500' />
    </div>
  )
}
