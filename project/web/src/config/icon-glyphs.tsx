/**
 * 由 `scripts/icons-build.mjs` 从 myIconpark 的 svg 生成 —— 不要手改这一个文件。
 *
 * 改图标：去 ../../../myIconpark/source 改（或加）svg，再跑 `pnpm icons:build`。
 * 改粗细／圆角／配色：`src/config/icon-runtime.tsx`，所有图标一起跟着变；哪个语义名用
 * 哪个图标：`src/config/icons.json`。
 *
 * 颜色按 IconPark 的四个槽来：c[0] 外描边、c[1] 外填充、c[2] 内描边（遮罩那块底）、
 * c[3] 内填充；槽里的具体颜色由主题决定（见 icon-runtime 的 `colorsFor`）。
 */
import type { Glyph } from "./icon-runtime"

export const glyphs = {
  "add": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <rect x="6" y="6" width="36" height="36" rx="3" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path d="M24 16V32" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M16 24L32 24" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "align-left-two": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <rect x="8" y="7" width="24" height="6" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <rect x="8" y="21" width="32" height="6" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <rect x="8" y="35" width="18" height="6" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "align-right-two": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <rect x="16" y="7" width="24" height="6" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <rect x="8" y="21" width="32" height="6" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <rect x="22" y="35" width="18" height="6" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "attention": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M24 44C29.5228 44 34.5228 41.7614 38.1421 38.1421C41.7614 34.5228 44 29.5228 44 24C44 18.4772 41.7614 13.4772 38.1421 9.85786C34.5228 6.23858 29.5228 4 24 4C18.4772 4 13.4772 6.23858 9.85786 9.85786C6.23858 13.4772 4 18.4772 4 24C4 29.5228 6.23858 34.5228 9.85786 38.1421C13.4772 41.7614 18.4772 44 24 44Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path fillRule="evenodd" clipRule="evenodd" d="M24 37C25.3807 37 26.5 35.8807 26.5 34.5C26.5 33.1193 25.3807 32 24 32C22.6193 32 21.5 33.1193 21.5 34.5C21.5 35.8807 22.6193 37 24 37Z" fill={c[2]} />
      <path d="M24 12V28" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "auto-width-one": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M6 7H42" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
      <path d="M8 24H40" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
      <path d="M13.9907 30L8 24.0046L14 18" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M34.0093 18L40 23.9954L34 30" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M6 41H42" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
    </>
  ),
  "avatar": ({ c, strokeWidth, strokeLinejoin }) => (
    <>
      <path d="M5.00372 42.2311C5.00372 42.6557 5.35807 42.9999 5.79521 42.9999L42.2023 43C42.6394 43 42.9938 42.6558 42.9938 42.2313V41.3131C43.012 41.0364 43.049 39.6555 42.1388 38.1289C41.5648 37.1663 40.7318 36.3347 39.6628 35.6573C38.3696 34.8378 36.7245 34.244 34.7347 33.8865C34.72 33.8846 33.2446 33.689 31.7331 33.303C29.101 32.6307 28.8709 32.0357 28.8694 32.0299C28.8539 31.9711 28.8315 31.9146 28.8028 31.8615C28.7813 31.7505 28.7281 31.3328 28.8298 30.2136C29.088 27.371 30.6128 25.691 31.838 24.3412C32.2244 23.9155 32.5893 23.5134 32.8704 23.1191C34.0827 21.4181 34.1952 19.4839 34.2003 19.364C34.2003 19.1211 34.1724 18.9214 34.1127 18.7363C33.9937 18.3659 33.7698 18.1351 33.6063 17.9666L33.6052 17.9654C33.564 17.923 33.5251 17.8828 33.4933 17.8459C33.4812 17.8318 33.449 17.7945 33.4783 17.603C33.5859 16.8981 33.6505 16.3079 33.6815 15.7456C33.7367 14.7438 33.7798 13.2456 33.5214 11.7875C33.4895 11.5385 33.4347 11.2755 33.3494 10.9622C33.0764 9.95814 32.6378 9.09971 32.0284 8.39124C31.9236 8.27722 29.3756 5.5928 21.9788 5.04201C20.956 4.96586 19.9449 5.00688 18.9496 5.05775C18.7097 5.06961 18.3812 5.08589 18.0738 5.16554C17.3101 5.36337 17.1063 5.84743 17.0528 6.11834C16.9641 6.56708 17.12 6.91615 17.2231 7.14718L17.2231 7.1472L17.2231 7.14723C17.2381 7.18072 17.2566 7.22213 17.2243 7.32997C17.0526 7.59588 16.7825 7.83561 16.5071 8.06273C16.4275 8.13038 14.5727 9.72968 14.4707 11.8189C14.1957 13.4078 14.2165 15.8834 14.5417 17.5944C14.5606 17.6889 14.5885 17.8288 14.5432 17.9233L14.5432 17.9233C14.1935 18.2367 13.7971 18.5919 13.7981 19.4024C13.8023 19.4839 13.9148 21.4181 15.1272 23.1191C15.408 23.5131 15.7726 23.9149 16.1587 24.3403L16.1596 24.3412L16.1596 24.3413C17.3848 25.6911 18.9095 27.371 19.1678 30.2135C19.2694 31.3327 19.2162 31.7505 19.1947 31.8614C19.166 31.9145 19.1436 31.971 19.1282 32.0298C19.1266 32.0356 18.8974 32.6287 16.2772 33.2996C14.7656 33.6867 13.2775 33.8845 13.2331 33.8909C11.2994 34.2173 9.66438 34.7963 8.37351 35.6115C7.30813 36.2844 6.47354 37.1175 5.89289 38.0877C4.96517 39.6379 4.99025 41.0497 5.00372 41.3074V42.2311Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "background-color": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path fillRule="evenodd" clipRule="evenodd" d="M37 37C39.2091 37 41 35.2091 41 33C41 31.5272 39.6667 29.5272 37 27C34.3333 29.5272 33 31.5272 33 33C33 35.2091 34.7909 37 37 37Z" fill={c[0]} />
      <path d="M20.8535 5.50439L24.389 9.03993" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
      <path d="M23.6818 8.33281L8.12549 23.8892L19.4392 35.2029L34.9955 19.6465L23.6818 8.33281Z" stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path d="M12 20.0732L28.961 25.6496" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
      <path d="M4 43H44" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
    </>
  ),
  "broadcast-one": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M24 15C26.7614 15 29 12.7614 29 10C29 7.23858 26.7614 5 24 5C21.2386 5 19 7.23858 19 10C19 12.7614 21.2386 15 24 15Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} />
      <path d="M24 15V23" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
      <path d="M30 23V33" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
      <path d="M18 23V33" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
      <path d="M7 33V23L41 23.0128V33" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M41 41V42" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
      <path d="M7 41V42" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
      <path d="M18 41V42" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
      <path d="M30 41V42" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
    </>
  ),
  "calendar-dot": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <rect x="4" y="4" width="40" height="40" rx="2" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M4 14H44" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <line x1="44" y1="11" x2="44" y2="23" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M12 22H16" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M22 22H26" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M32 22H36" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M12 29H16" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M22 29H26" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M32 29H36" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M12 36H16" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M22 36H26" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M32 36H36" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <line x1="4" y1="11" x2="4" y2="23" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "caution": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path fillRule="evenodd" clipRule="evenodd" d="M24 5L2 43H46L24 5Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path d="M24 35V36" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
      <path d="M24 19.0005L24.0083 29" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
    </>
  ),
  "chart-graph": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <rect x="17" y="6" width="14" height="9" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <rect x="6" y="33" width="14" height="9" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <rect x="28" y="33" width="14" height="9" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path d="M24 16V24" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M13 33V24H35V33" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "check": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M43 11L16.875 37L5 25.1818" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "close": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M8 8L40 40" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M8 40L40 8" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "close-one": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M24 44C35.0457 44 44 35.0457 44 24C44 12.9543 35.0457 4 24 4C12.9543 4 4 12.9543 4 24C4 35.0457 12.9543 44 24 44Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path d="M29.6567 18.3432L18.343 29.6569" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M18.3433 18.3432L29.657 29.6569" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "code": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M16 13L4 25.4322L16 37" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M32 13L44 25.4322L32 37" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M28 4L21 44" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
    </>
  ),
  "comment": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M44 6H4V36H13V41L23 36H44V6Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M14 19.5V22.5" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M24 19.5V22.5" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M34 19.5V22.5" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "connection-point": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M5 24L43 24" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M28 4H20C18.8954 4 18 4.89543 18 6V14C18 15.1046 18.8954 16 20 16H28C29.1046 16 30 15.1046 30 14V6C30 4.89543 29.1046 4 28 4Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path d="M16 32H8C6.89543 32 6 32.8954 6 34V42C6 43.1046 6.89543 44 8 44H16C17.1046 44 18 43.1046 18 42V34C18 32.8954 17.1046 32 16 32Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path d="M40 32H32C30.8954 32 30 32.8954 30 34V42C30 43.1046 30.8954 44 32 44H40C41.1046 44 42 43.1046 42 42V34C42 32.8954 41.1046 32 40 32Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path d="M24 24V16" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M36 32V24" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M12 32V24" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "copy": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M13 12.4316V7.8125C13 6.2592 14.2592 5 15.8125 5H40.1875C41.7408 5 43 6.2592 43 7.8125V32.1875C43 33.7408 41.7408 35 40.1875 35H35.5163" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M32.1875 13H7.8125C6.2592 13 5 14.2592 5 15.8125V40.1875C5 41.7408 6.2592 43 7.8125 43H32.1875C33.7408 43 35 41.7408 35 40.1875V15.8125C35 14.2592 33.7408 13 32.1875 13Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "delete": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M9 10V44H39V10H9Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path d="M20 20V33" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M28 20V33" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M4 10H44" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M16 10L19.289 4H28.7771L32 10H16Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "double-left": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M24 36L12 24L24 12" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M36 36L24 24L36 12" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "double-right": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M12 12L24 24L12 36" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M24 12L36 24L24 36" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "down": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M36 18L24 30L12 18" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "drag": ({ c }) => (
    <>
      <path fillRule="evenodd" clipRule="evenodd" d="M19 10C19 12.2091 17.2091 14 15 14C12.7909 14 11 12.2091 11 10C11 7.79086 12.7909 6 15 6C17.2091 6 19 7.79086 19 10ZM15 28C17.2091 28 19 26.2091 19 24C19 21.7909 17.2091 20 15 20C12.7909 20 11 21.7909 11 24C11 26.2091 12.7909 28 15 28ZM15 42C17.2091 42 19 40.2091 19 38C19 35.7909 17.2091 34 15 34C12.7909 34 11 35.7909 11 38C11 40.2091 12.7909 42 15 42Z" fill={c[0]} />
      <path fillRule="evenodd" clipRule="evenodd" d="M37 10C37 12.2091 35.2091 14 33 14C30.7909 14 29 12.2091 29 10C29 7.79086 30.7909 6 33 6C35.2091 6 37 7.79086 37 10ZM33 28C35.2091 28 37 26.2091 37 24C37 21.7909 35.2091 20 33 20C30.7909 20 29 21.7909 29 24C29 26.2091 30.7909 28 33 28ZM33 42C35.2091 42 37 40.2091 37 38C37 35.7909 35.2091 34 33 34C30.7909 34 29 35.7909 29 38C29 40.2091 30.7909 42 33 42Z" fill={c[0]} />
    </>
  ),
  "edit": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M7 42H43" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M11 26.7199V34H18.3172L39 13.3081L31.6951 6L11 26.7199Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "error": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path fillRule="evenodd" clipRule="evenodd" d="M6 11L11 6L24 19L37 6L42 11L29 24L42 37L37 42L24 29L11 42L6 37L19 24L6 11Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "export": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M42 27C42 33 38 43 24 43C10 43 6 33 6 27" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M24.0078 5.10059V33.0001" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M12 17L24 5L36 17" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "factory-building": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M4 44V4H12V20L28 12V20L44 12V44H4Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <rect x="12" y="28" width="8" height="8" fill={c[3]} stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <rect x="28" y="28" width="8" height="8" fill={c[3]} stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "file-text": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M10 44H38C39.1046 44 40 43.1046 40 42V14H30V4H10C8.89543 4 8 4.89543 8 6V42C8 43.1046 8.89543 44 10 44Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M30 4L40 14" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M24 22V36" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M18 22H24L30 22" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "filter": ({ c, strokeWidth, strokeLinejoin }) => (
    <>
      <path d="M6 9L20.4 25.8178V38.4444L27.6 42V25.8178L42 9H6Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "full-screen": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M33 6H42V15" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M42 33V42H33" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M15 42H6V33" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M6 15V6H15" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "full-selection": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M34 5H8C6.34315 5 5 6.34315 5 8V34C5 35.6569 6.34315 37 8 37H34C35.6569 37 37 35.6569 37 34V8C37 6.34315 35.6569 5 34 5Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path d="M43.9998 13.002V42.0001C43.9998 43.1046 43.1044 44.0001 41.9998 44.0001H13.0034" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M13 20.4858L18.9997 26.0109L29 15.7192" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "hamburger-button": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M7.94971 11.9497H39.9497" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M7.94971 23.9497H39.9497" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M7.94971 35.9497H39.9497" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "hashtag-key": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <rect x="6" y="6" width="36" height="36" rx="3" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M19 16V32" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M29 16V32" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M16 19H32" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M16 29H32" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "help": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M24 44C29.5228 44 34.5228 41.7614 38.1421 38.1421C41.7614 34.5228 44 29.5228 44 24C44 18.4772 41.7614 13.4772 38.1421 9.85786C34.5228 6.23858 29.5228 4 24 4C18.4772 4 13.4772 6.23858 9.85786 9.85786C6.23858 13.4772 4 18.4772 4 24C4 29.5228 6.23858 34.5228 9.85786 38.1421C13.4772 41.7614 18.4772 44 24 44Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path d="M24 28.6248V24.6248C27.3137 24.6248 30 21.9385 30 18.6248C30 15.3111 27.3137 12.6248 24 12.6248C20.6863 12.6248 18 15.3111 18 18.6248" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path fillRule="evenodd" clipRule="evenodd" d="M24 37.6248C25.3807 37.6248 26.5 36.5055 26.5 35.1248C26.5 33.7441 25.3807 32.6248 24 32.6248C22.6193 32.6248 21.5 33.7441 21.5 35.1248C21.5 36.5055 22.6193 37.6248 24 37.6248Z" fill={c[2]} />
    </>
  ),
  "history": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M5.81836 6.72729V14H13.0911" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M4 24C4 35.0457 12.9543 44 24 44V44C35.0457 44 44 35.0457 44 24C44 12.9543 35.0457 4 24 4C16.598 4 10.1351 8.02111 6.67677 13.9981" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M24.005 12L24.0038 24.0088L32.4832 32.4882" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "indent-left": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M6 9H42" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M19 19H42" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M19 29H42" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M11 19L6 24L11 29" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M6 39H42" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "indent-right": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M42 9H6" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M29 19H6" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M29 29H6" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M37 19L42 24L37 29" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M42 39H6" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "info": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M24 44C29.5228 44 34.5228 41.7614 38.1421 38.1421C41.7614 34.5228 44 29.5228 44 24C44 18.4772 41.7614 13.4772 38.1421 9.85786C34.5228 6.23858 29.5228 4 24 4C18.4772 4 13.4772 6.23858 9.85786 9.85786C6.23858 13.4772 4 18.4772 4 24C4 29.5228 6.23858 34.5228 9.85786 38.1421C13.4772 41.7614 18.4772 44 24 44Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path fillRule="evenodd" clipRule="evenodd" d="M24 11C25.3807 11 26.5 12.1193 26.5 13.5C26.5 14.8807 25.3807 16 24 16C22.6193 16 21.5 14.8807 21.5 13.5C21.5 12.1193 22.6193 11 24 11Z" fill={c[2]} />
      <path d="M24.5 34V20H23.5H22.5" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M21 34H28" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "key": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M22.8682 24.2982C25.4105 26.7935 26.4138 30.4526 25.4971 33.8863C24.5805 37.32 21.8844 40.0019 18.4325 40.9137C14.9806 41.8256 11.3022 40.8276 8.79375 38.2986C5.02208 34.4141 5.07602 28.2394 8.91499 24.4206C12.754 20.6019 18.9613 20.5482 22.8664 24.3L22.8682 24.2982Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path d="M23 24L40 7" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M30.3052 16.9001L35.7337 22.3001L42.0671 16.0001L36.6385 10.6001L30.3052 16.9001Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "layers": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M4 11.9143L24 19L44 11.9143L24 5L4 11.9143Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path d="M4 20L24 27L44 20" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M4 28L24 35L44 28" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M4 36L24 43L44 36" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "layout-one": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <rect x="6" y="6" width="36" height="36" rx="3" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path d="M6 16H42" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M6 13V19" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M42 14V20" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M32 16V42" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M29 42H35" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "left": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M31 36L19 24L31 12" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "link": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M24.7073 9.56521L9.85801 24.4145C6.34329 27.9292 6.34329 33.6277 9.85801 37.1424V37.1424C13.3727 40.6571 19.0712 40.6571 22.5859 37.1424L40.2636 19.4647C42.6067 17.1216 42.6067 13.3226 40.2636 10.9794V10.9794C37.9205 8.63628 34.1215 8.63628 31.7783 10.9794L14.1007 28.6571C12.9291 29.8287 12.9291 31.7282 14.1007 32.8997V32.8997C15.2722 34.0713 17.1717 34.0713 18.3433 32.8997L33.1925 18.0505" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "loading-four": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M4 24C4 35.0457 12.9543 44 24 44C35.0457 44 44 35.0457 44 24C44 12.9543 35.0457 4 24 4" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "lock": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <rect x="6" y="22" width="36" height="22" rx="2" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path d="M14 22V14C14 8.47715 18.4772 4 24 4C29.5228 4 34 8.47715 34 14V22" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M24 30V36" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "logout": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M23.9917 6H6V42H24" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M33 33L42 24L33 15" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M16 23.9917H42" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "magic": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M20.1005 8.1005L24.3431 12.3431M30 4V10V4ZM39.8995 8.1005L35.6569 12.3431L39.8995 8.1005ZM44 18H38H44ZM39.8995 27.8995L35.6569 23.6569L39.8995 27.8995ZM30 32V26V32ZM20.1005 27.8995L24.3431 23.6569L20.1005 27.8995ZM16 18H22H16Z" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M29.5856 18.4143L5.54395 42.4559" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "monitor": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <rect x="4" y="10" width="32" height="28" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path fillRule="evenodd" clipRule="evenodd" d="M44 14L36 20.75V27.25L44 34V14Z" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M17 19L23 24L17 29" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "moon": ({ c, strokeWidth, strokeLinejoin }) => (
    <>
      <path d="M28.0527 4.41085C22.5828 5.83695 18.5455 10.8106 18.5455 16.7273C18.5455 23.7564 24.2436 29.4545 31.2727 29.4545C37.1894 29.4545 42.1631 25.4172 43.5891 19.9473C43.8585 21.256 44 22.6115 44 24C44 35.0457 35.0457 44 24 44C12.9543 44 4 35.0457 4 24C4 12.9543 12.9543 4 24 4C25.3885 4 26.744 4.14149 28.0527 4.41085Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "more": ({ c }) => (
    <>
      <circle cx="12" cy="24" r="3" fill={c[0]} />
      <circle cx="24" cy="24" r="3" fill={c[0]} />
      <circle cx="36" cy="24" r="3" fill={c[0]} />
    </>
  ),
  "paragraph-break": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M6 4V44" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M42 4V44" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M18 26L14 30L18 34" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M15 30C15 30 25.7909 30 28 30C31.3137 30 34 27.3137 34 24C34 20.6863 31.3137 18 28 18C26.6852 18 14 18 14 18" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "redo": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M36.7279 36.7279C33.4706 39.9853 28.9706 42 24 42C14.0589 42 6 33.9411 6 24C6 14.0589 14.0589 6 24 6C28.9706 6 33.4706 8.01472 36.7279 11.2721C38.3859 12.9301 42 17 42 17" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M42 8V17H33" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "refresh": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M42 8V24" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M6 24L6 40" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M42 24C42 14.0589 33.9411 6 24 6C18.9145 6 14.3216 8.10896 11.0481 11.5M6 24C6 33.9411 14.0589 42 24 42C28.8556 42 33.2622 40.0774 36.5 36.9519" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "right": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M19 12L31 24L19 36" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "robot": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <rect x="9" y="17" width="30" height="26" rx="2" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M33 9L28 17" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M15 9L20 17" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <circle cx="34" cy="7" r="2" stroke={c[0]} strokeWidth={strokeWidth} />
      <circle cx="14" cy="7" r="2" stroke={c[0]} strokeWidth={strokeWidth} />
      <rect x="16" y="24" width="16" height="8" rx="4" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} />
      <path d="M9 24H4V34H9" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M39 24H44V34H39" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "schedule": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <rect x="4" y="10" width="40" height="30" rx="2" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M14 6V14" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
      <path d="M25 23L14 23" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
      <path d="M34 31L14 31" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
      <path d="M34 6V14" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
    </>
  ),
  "search": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M21 38C30.3888 38 38 30.3888 38 21C38 11.6112 30.3888 4 21 4C11.6112 4 4 11.6112 4 21C4 30.3888 11.6112 38 21 38Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path d="M26.657 14.3431C25.2093 12.8954 23.2093 12 21.0001 12C18.791 12 16.791 12.8954 15.3433 14.3431" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M33.2216 33.2217L41.7069 41.707" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "setting": ({ c, strokeWidth, strokeLinejoin }) => (
    <>
      <path d="M36.686 15.171C37.9364 16.9643 38.8163 19.0352 39.2147 21.2727H44V26.7273H39.2147C38.8163 28.9648 37.9364 31.0357 36.686 32.829L40.0706 36.2137L36.2137 40.0706L32.829 36.686C31.0357 37.9364 28.9648 38.8163 26.7273 39.2147V44H21.2727V39.2147C19.0352 38.8163 16.9643 37.9364 15.171 36.686L11.7863 40.0706L7.92939 36.2137L11.314 32.829C10.0636 31.0357 9.18372 28.9648 8.78533 26.7273H4V21.2727H8.78533C9.18372 19.0352 10.0636 16.9643 11.314 15.171L7.92939 11.7863L11.7863 7.92939L15.171 11.314C16.9643 10.0636 19.0352 9.18372 21.2727 8.78533V4H26.7273V8.78533C28.9648 9.18372 31.0357 10.0636 32.829 11.314L36.2137 7.92939L40.0706 11.7863L36.686 15.171Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path d="M24 29C26.7614 29 29 26.7614 29 24C29 21.2386 26.7614 19 24 19C21.2386 19 19 21.2386 19 24C19 26.7614 21.2386 29 24 29Z" fill={c[3]} stroke={c[2]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "shield": ({ c, strokeWidth, strokeLinejoin }) => (
    <>
      <path d="M6 8.25564L24.0086 3L42 8.25564V19.0337C42 30.3622 34.7502 40.4194 24.0026 44.0005C13.2521 40.4195 6 30.36 6 19.0287V8.25564Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "success": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M24 4L29.2533 7.83204L35.7557 7.81966L37.7533 14.0077L43.0211 17.8197L41 24L43.0211 30.1803L37.7533 33.9923L35.7557 40.1803L29.2533 40.168L24 44L18.7467 40.168L12.2443 40.1803L10.2467 33.9923L4.97887 30.1803L7 24L4.97887 17.8197L10.2467 14.0077L12.2443 7.81966L18.7467 7.83204L24 4Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M17 24L22 29L32 19" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "sun": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M9.15039 9.15088L11.3778 11.3783" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M3 24H6.15" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M9.15039 38.8495L11.3778 36.6221" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M38.8495 38.8495L36.6221 36.6221" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M44.9996 24H41.8496" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M38.8495 9.15088L36.6221 11.3783" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M24 3V6.15" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M24 36C30.6274 36 36 30.6274 36 24C36 17.3726 30.6274 12 24 12C17.3726 12 12 17.3726 12 24C12 30.6274 17.3726 36 24 36Z" fill={c[2]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path d="M24 45.0001V41.8501" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "tag": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M8 44L8 6C8 4.89543 8.89543 4 10 4H38C39.1046 4 40 4.89543 40 6V44L24 35.7273L8 44Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinejoin={strokeLinejoin} />
      <path d="M16 18H32" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "text-wrap-truncation": ({ c, strokeWidth, strokeLinecap }) => (
    <>
      <path d="M8 8V40" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
      <path d="M40 8V40" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
      <path d="M20.0522 24.0083H40.0002" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} />
    </>
  ),
  "thunderbolt": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M4 26C4 24.8954 4.89543 24 6 24H42C43.1046 24 44 24.8954 44 26V31.3604C44 32.3138 43.3167 33.1412 42.4802 33.5984C41.2932 34.2471 39.7561 35.5405 39.2065 38.0136C38.9669 39.0919 38.1046 40 37 40H11C9.89543 40 9.03308 39.0919 8.79348 38.0136C8.24394 35.5405 6.70677 34.2471 5.51983 33.5984C4.68326 33.1412 4 32.3138 4 31.3604V26Z" fill={c[1]} stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M14 31H34" stroke={c[2]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M25 4L19 11H29L23 18" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "translate": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M28.2857 37H39.7143M42 42L39.7143 37L42 42ZM26 42L28.2857 37L26 42ZM28.2857 37L34 24L39.7143 37H28.2857Z" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M16 6L17 9" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M6 11H28" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M10 16C10 16 11.7895 22.2609 16.2632 25.7391C20.7368 29.2174 28 32 28 32" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M24 11C24 11 22.2105 19.2174 17.7368 23.7826C13.2632 28.3478 6 32 6 32" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "undo": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M11.2721 36.7279C14.5294 39.9853 19.0294 42 24 42C33.9411 42 42 33.9411 42 24C42 14.0589 33.9411 6 24 6C19.0294 6 14.5294 8.01472 11.2721 11.2721C9.61407 12.9301 6 17 6 17" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
      <path d="M6 9V17H14" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
  "up": ({ c, strokeWidth, strokeLinecap, strokeLinejoin }) => (
    <>
      <path d="M13 30L25 18L37 30" stroke={c[0]} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} />
    </>
  ),
} satisfies Record<string, Glyph>
