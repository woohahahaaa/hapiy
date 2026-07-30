import { Handle, Position } from '@xyflow/react'
import { SlotContainer } from '@/components/topology/SlotContainer'
import { SlotNodeItem } from '@/components/topology/SlotNodeItem'
import { SlotErrorBox } from '@/components/topology/SlotErrorBox'
import { topologyConfig } from '@/config/topology-config'

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
        className="!rounded-full !border-border !bg-background"
        style={{
          width: topologyConfig.handles.slot.target.width,
          height: topologyConfig.handles.slot.target.height,
          borderWidth: topologyConfig.handles.slot.target.borderWidth,
        }}
      />
      <SlotContainer
        title={title}
        slotType={data.slotType}
        onAddNode={onAddNode}
        style={{ width: topologyConfig.nodeDimensions.slot.width }}
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
        className="!rounded-full !border-border !bg-background"
        style={{
          width: topologyConfig.handles.slot.source.width,
          height: topologyConfig.handles.slot.source.height,
          borderWidth: topologyConfig.handles.slot.source.borderWidth,
        }}
      />
    </>
  )
}
