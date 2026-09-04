import { literalCapable, type Action } from './serializer'
import { ConventionValueInput } from './ConventionValueInput'

interface LiteralValueInputProps {
  action: Action
  onChange: (next: Action) => void
  placeholder?: string
}

// value 输入遵循「字符串需手动加引号」约定：true/false/null/数字直接写，
// 字符串要写成带引号的 JSON 形式（如 "hello"）；仅 literalCapable 的 action 生效。
export function LiteralValueInput({ action, onChange, placeholder }: LiteralValueInputProps) {
  return (
    <ConventionValueInput
      active={literalCapable(action)}
      text={action.value}
      onChange={(value) => onChange({ ...action, value })}
      placeholder={placeholder}
    />
  )
}
