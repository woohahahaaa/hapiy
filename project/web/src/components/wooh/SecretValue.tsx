import { useEffect, useRef, useState } from 'react'

// 上游 Key 默认模糊，hover 或点击（含触屏）后显示明文，点击后 5 秒恢复模糊。
// 有备注时 Key 占第一行，备注在第二行加括号（不模糊），只有 Key 模糊。
export function SecretValue({ value, note }: { readonly value: string; readonly note?: string }) {
  const [revealed, setRevealed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const handleClick = () => {
    setRevealed(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setRevealed(false), 5000)
  }

  return (
    <span
      className="break-all font-mono leading-relaxed"
      onClick={handleClick}
    >
      <span className={`block blur-sm hover:blur-none ${revealed ? 'blur-none!' : ''}`}>
        {value || '-'}
      </span>
      {note && <span className="block">({note})</span>}
    </span>
  )
}
