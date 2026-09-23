import { allowJsonLiterals, valueConventionActive, type Action } from './serializer'
import { ConventionValueInput } from './ConventionValueInput'

interface LiteralValueInputProps {
  action: Action
  onChange: (next: Action) => void
  placeholder?: string
}

// value 输入遵循「引号约定」：不带引号的裸文本是变量引用（取原始请求同域值）；
// body scope 下 true/false/null/数字是 JSON 字面量；固定字符串写成带引号的 JSON
// 形式（如 "hello"）；仅 set 模式的 action 生效。
export function LiteralValueInput({ action, onChange, placeholder }: LiteralValueInputProps) {
  return (
    <ConventionValueInput
      active={valueConventionActive(action)}
      refs
      literals={allowJsonLiterals(action)}
      text={action.value}
      onChange={(value) => onChange({ ...action, value })}
      placeholder={placeholder}
    />
  )
}
