import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ArrowUpFromLine } from 'lucide-react'

import type { PlaygroundNode } from '../../mock/data'

export function ExitNode({ selected }: NodeProps<PlaygroundNode>) {
  return (
    <div
      className={`relative w-[260px] rounded-2xl border-2 bg-gradient-to-br from-rose-500/10 to-rose-500/5 p-4 shadow-lg backdrop-blur-sm transition-shadow hover:shadow-rose-500/20 ${
        selected ? 'border-rose-400 shadow-rose-500/30' : 'border-rose-500/30'
      }`}
    >
      <Handle type='target' position={Position.Left} className='!h-3 !w-3 !border-[3px] !border-background !bg-rose-500' />
      <div className='flex items-center gap-3'>
        <div className='flex size-9 items-center justify-center rounded-xl bg-rose-500/20'>
          <ArrowUpFromLine className='size-5 text-rose-500' />
        </div>
        <div>
          <p className='text-sm font-semibold'>Exit</p>
          <p className='text-xs text-muted-foreground'>Response exit point</p>
        </div>
      </div>
    </div>
  )
}
