import { Handle, Position, type NodeProps } from '@xyflow/react'
import { MessageCircleReply } from 'lucide-react'

import type { PlaygroundNode } from '../../mock/data'

export function AutoReplyNode({ selected, data }: NodeProps<PlaygroundNode>) {
  return (
    <div
      className={`relative w-[260px] rounded-2xl border-2 bg-gradient-to-br from-cyan-500/10 to-cyan-500/5 p-4 shadow-lg backdrop-blur-sm transition-shadow hover:shadow-cyan-500/20 ${
        selected ? 'border-cyan-400 shadow-cyan-500/30' : 'border-cyan-500/30'
      }`}
    >
      <Handle type='target' position={Position.Left} className='!h-3 !w-3 !border-[3px] !border-background !bg-cyan-500' />
      <div className='flex items-center gap-3'>
        <div className='flex size-9 items-center justify-center rounded-xl bg-cyan-500/20'>
          <MessageCircleReply className='size-5 text-cyan-500' />
        </div>
        <div>
          <p className='text-sm font-semibold'>Auto-Reply</p>
          <p className='text-xs text-muted-foreground'>Rule: {data.ruleName ?? 'None'}</p>
        </div>
      </div>
      <Handle type='source' position={Position.Right} className='!h-3 !w-3 !border-[3px] !border-background !bg-cyan-500' />
    </div>
  )
}
