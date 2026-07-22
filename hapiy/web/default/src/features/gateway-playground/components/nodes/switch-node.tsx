import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ArrowLeftRight } from 'lucide-react'

import type { PlaygroundNode } from '../../mock/data'

export function SwitchNode({ selected, data }: NodeProps<PlaygroundNode>) {
  return (
    <div
      className={`relative w-[260px] rounded-2xl border-2 bg-gradient-to-br from-orange-500/10 to-orange-500/5 p-4 shadow-lg backdrop-blur-sm transition-shadow hover:shadow-orange-500/20 ${
        selected ? 'border-orange-400 shadow-orange-500/30' : 'border-orange-500/30'
      }`}
    >
      <Handle type='target' position={Position.Left} className='!h-3 !w-3 !border-[3px] !border-background !bg-orange-500' />
      <div className='flex items-center gap-3'>
        <div className='flex size-9 items-center justify-center rounded-xl bg-orange-500/20'>
          <ArrowLeftRight className='size-5 text-orange-500' />
        </div>
        <div>
          <p className='text-sm font-semibold'>Auto-Switch</p>
          <p className='text-xs text-muted-foreground'>Rule: {data.ruleName ?? 'None'}</p>
        </div>
      </div>
      <Handle type='source' position={Position.Right} className='!h-3 !w-3 !border-[3px] !border-background !bg-orange-500' />
    </div>
  )
}
