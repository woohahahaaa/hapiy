import { Handle, Position } from '@xyflow/react'
import { SlotContainer } from '@/components/topology/SlotContainer'
import { SlotNodeItem } from '@/components/topology/SlotNodeItem'
import { SlotErrorBox } from '@/components/topology/SlotErrorBox'

interface SlotNodeData {
  slotType: string
  providerId: string
  title: string
  nodes: Array<{ index: number; ruleId: string; ruleName: string }>
  onAddNode?: () => void
  onDeleteNode?: (index: number) => void
}

interface SlotNodeProps {
  data: SlotNodeData
  id: string
}

export function SlotNode({ data }: SlotNodeProps) {
  const { title, nodes, onAddNode, onDeleteNode } = data

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2 !rounded-full !border-2 !border-border !bg-background"
      />
      <SlotContainer
        title={title}
        slotType={data.slotType}
        onAddNode={onAddNode}
      >
        {nodes.map((n) => (
          <SlotNodeItem
            key={n.index}
            index={n.index}
            label={n.ruleName}
            onDelete={onDeleteNode ? () => onDeleteNode(n.index) : undefined}
          />
        ))}
      </SlotContainer>
      <SlotErrorBox error={null} />
      <Handle
        type="source"
        position={Position.Right}
        className="!size-2 !rounded-full !border-2 !border-border !bg-background"
      />
    </>
  )
}
