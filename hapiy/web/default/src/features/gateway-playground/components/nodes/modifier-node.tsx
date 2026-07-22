import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FileEdit } from 'lucide-react'

import type { PlaygroundNode } from '../../mock/data'

export function ModifierNode({ selected, data }: NodeProps<PlaygroundNode>) {
  return (
    <div
      className={`relative w-[260px] rounded-2xl border-2 bg-gradient-to-br from-violet-500/10 to-violet-500/5 p-4 shadow-lg backdrop-blur-sm transition-shadow hover:shadow-violet-500/20 ${
        selected ? 'border-violet-400 shadow-violet-500/30' : 'border-violet-500/30'
      }`}
    >
      <Handle type='target' position={Position.Left} className='!h-3 !w-3 !border-[3px] !border-background !bg-violet-500' />
      <div className='flex items-center gap-3'>
        <div className='flex size-9 items-center justify-center rounded-xl bg-violet-500/20'>
          <FileEdit className='size-5 text-violet-500' />
        </div>
        <div>
          <p className='text-sm font-semibold'>Request Modifier</p>
          <p className='text-xs text-muted-foreground'>Rule: {data.ruleName ?? 'None'}</p>
        </div>
      </div>
      <Handle type='source' position={Position.Right} className='!h-3 !w-3 !border-[3px] !border-background !bg-violet-500' />
    </div>
  )
}
