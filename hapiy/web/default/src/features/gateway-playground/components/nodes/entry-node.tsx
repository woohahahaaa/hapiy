import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ArrowDownToLine } from 'lucide-react'

import type { PlaygroundNode } from '../../mock/data'

export function EntryNode({ selected }: NodeProps<PlaygroundNode>) {
  return (
    <div
      className={`relative w-[260px] rounded-2xl border-2 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 p-4 shadow-lg backdrop-blur-sm transition-shadow hover:shadow-emerald-500/20 ${
        selected ? 'border-emerald-400 shadow-emerald-500/30' : 'border-emerald-500/30'
      }`}
    >
      <div className='flex items-center gap-3'>
        <div className='flex size-9 items-center justify-center rounded-xl bg-emerald-500/20'>
          <ArrowDownToLine className='size-5 text-emerald-500' />
        </div>
        <div>
          <p className='text-sm font-semibold'>Entry</p>
          <p className='text-xs text-muted-foreground'>Request entry point</p>
        </div>
      </div>
      <Handle type='source' position={Position.Right} className='!h-3 !w-3 !border-[3px] !border-background !bg-emerald-500' />
    </div>
  )
}
