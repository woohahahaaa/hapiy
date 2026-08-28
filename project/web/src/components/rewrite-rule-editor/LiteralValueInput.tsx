import { Input } from '@/components/ui/input'
import { literalCapable, parseValueInput, type Action } from './serializer'

interface LiteralValueInputProps {
  action: Action
  onChange: (next: Action) => void
  placeholder?: string
}

// value 输入遵循「字符串需手动加引号」约定：true/false/null/数字直接写，
// 字符串要写成带引号的 JSON 形式（如 "hello"）；不合法文本在输入框下方提示。
export function LiteralValueInput({ action, onChange, placeholder }: LiteralValueInputProps) {
  const invalid =
    literalCapable(action) && action.value.trim() !== '' && parseValueInput(action.value).kind === 'invalid'

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <Input
        className="h-7 w-full font-mono text-xs"
        value={action.value}
        onChange={(e) => onChange({ ...action, value: e.target.value })}
        placeholder={placeholder}
      />
      {invalid && <p className="text-xs text-muted-foreground">字符串需要手动添加引号</p>}
    </div>
  )
}
