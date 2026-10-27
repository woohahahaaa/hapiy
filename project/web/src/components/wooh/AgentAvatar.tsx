// AgentAvatar is the chat identity mark: a black disc with "hi" set in the
// hapiy logo face (Cookie), shipped inline as SVG so the webfont applies.
// Inline rather than a file: an <img> SVG cannot use the page's loaded font.
export function AgentAvatar({
  size = 36,
  className,
}: {
  readonly size?: number
  readonly className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      role="img"
      aria-label="hi"
    >
      <circle cx="24" cy="24" r="23.25" fill="#0a0a0a" stroke="rgba(255,255,255,0.16)" strokeWidth="1.5" />
      <text
        x="24"
        y="26"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#ffffff"
        fontFamily="Cookie, cursive"
        fontSize="24"
        letterSpacing="-0.3"
      >
        hi
      </text>
    </svg>
  )
}
