// Pure parser for the inline color-tag syntax used by ColorText:
//   "<#FF0000>红色</#FF0000>和<#00FF00>绿色</#FF0000>"
// → [{ text: "红色", color: "#FF0000" }, { text: "和" }, { text: "绿色", color: "#00FF00" }]
//
// Rules:
//   - `<#hex>text</#hex>` renders text with the given color
//   - a close tag ends the current segment regardless of its hex value
//   - a naked `<#hex>` whose hex matches the current color closes the segment
//   - `\<` and `\>` escape literal angle brackets
//   - malformed/unclosed tags fall through as literal text

const OPEN_TAG_RE = /^<#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})>/;
const CLOSE_TAG_RE = /^<\/#[0-9a-fA-F]+>/;

export function parseColorTags(
  input: string
): Array<{ text: string; color?: string }> {
  const segments: Array<{ text: string; color?: string }> = [];
  let buffer = "";
  let currentColor: string | undefined = undefined;
  let i = 0;

  const flush = () => {
    if (buffer.length > 0) {
      segments.push({ text: buffer, color: currentColor });
      buffer = "";
    }
  };

  while (i < input.length) {
    const remaining = input.slice(i);
    const ch = remaining[0];

    if (ch === "\\" && (remaining[1] === "<" || remaining[1] === ">")) {
      buffer += remaining[1];
      i += 2;
      continue;
    }

    if (currentColor !== undefined) {
      const closeMatch = remaining.match(CLOSE_TAG_RE);
      if (closeMatch) {
        flush();
        currentColor = undefined;
        i += closeMatch[0].length;
        continue;
      }
    }

    const openMatch = remaining.match(OPEN_TAG_RE);
    if (openMatch) {
      const hex = "#" + openMatch[1];
      if (
        currentColor !== undefined &&
        hex.toLowerCase() === currentColor.toLowerCase()
      ) {
        flush();
        currentColor = undefined;
      } else {
        flush();
        currentColor = hex;
      }
      i += openMatch[0].length;
      continue;
    }

    buffer += ch;
    i += 1;
  }

  flush();
  return segments;
}
