import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Gauge } from 'lucide-react'

import type { PlaygroundNode } from '../../mock/data'

export function ConcurrencyNode({ selected, data }: NodeProps<PlaygroundNode>) {
  return (
    <div
      className={`relative w-[260px] rounded-2xl border-2 bg-gradient-to-br from-yellow-500/10 to-yellow-500/5 p-4 shadow-lg backdrop-blur-sm transition-shadow hover:shadow-yellow-500/20 ${
        selected ? 'border-yellow-400 shadow-yellow-500/30' : 'border-yellow-500/30'
      }`}
    >
      <Handle type='target' position={Position.Left} className='!h-3 !w-3 !border-[3px] !border-background !bg-yellow-500' />
      <div className='flex items-center gap-3'>
        <div className='flex size-9 items-center justify-center rounded-xl bg-yellow-500/20'>
          <Gauge className='size-5 text-yellow-600' />
        </div>
        <div>
          <p className='text-sm font-semibold'>Concurrency</p>
          <p className='text-xs text-muted-foreground'>Limit: {data.limit ?? 10} concurrent</p>
        </div>
      </div>
      <Handle type='source' position={Position.Right} className='!h-3 !w-3 !border-[3px] !border-background !bg-yellow-500' />
    </div>
  )
}
