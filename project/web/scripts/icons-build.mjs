#!/usr/bin/env node
/**
 * Turns the icon sources in `myIconpark` into `src/config/icon-glyphs.tsx` — the web
 * app no longer installs `@icon-park/react`, it draws the same icons itself.
 *
 *   node scripts/icons-build.mjs           (aliased as `pnpm icons:build`)
 *   node scripts/icons-build.mjs --check   (aliased as `pnpm icons:check`)
 *
 * Which icons get inlined is decided by `src/config/icons.json`: every value there is
 * one icon's file name, looked up as `<MYICONPARK_DIR>/source/<分类>/<名字>.svg`.
 * Adding an icon is therefore: drop the svg into myIconpark, add one line to
 * `icons.json`, re-run this script.
 *
 * The source dir defaults to `../../../myIconpark` (the checkout next to the repo);
 * set `MYICONPARK_DIR` to point somewhere else. Only generation needs it — the
 * generated file is committed, so build and dev never look for the SVGs.
 */
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const iconsFile = path.join(root, "src/config/icons.json");
const outFile = path.join(root, "src/config/icon-glyphs.tsx");
const check = process.argv.includes("--check");

const parkDir = path.resolve(
  root,
  process.env.MYICONPARK_DIR ?? "../../../myIconpark",
);
const sourceDir = path.join(parkDir, "source");

/** IconPark's four colour slots, whatever colour the source file wrote. */
const SLOTS = {
  black: 0, // 外描边（outStroke）
  "#2F88FF": 1, // 外填充（outFill）
  white: 2, // 内描边（innerStroke），也是遮罩那块底
  "#43CCF8": 3, // 内填充（innerFill）
};

/** Every icon name `icons.json` points at, in the order they appear there. */
async function wantedNames() {
  const config = JSON.parse(await fs.readFile(iconsFile, "utf8"));
  const names = Object.values(config.icons);
  return [...new Set(names)].sort();
}

async function findSource(name) {
  for (const category of await fs.readdir(sourceDir)) {
    const file = path.join(sourceDir, category, `${name}.svg`);
    try {
      await fs.access(file);
      return file;
    } catch {
      // Next category.
    }
  }
  throw new Error(
    `myIconpark 里没有 source/*/${name}.svg —— 图标名对不上，或者该把它加进 ${parkDir}`,
  );
}

/**
 * 上游编译时会丢掉 Figma 导出留下的那块 48×48、1% 不透明的白色垫底（点击区域用的），
 * `full-selection`、`cutting-one` 这种图标里都有；这里照做，免得图标平白多占一块热区。
 */
function isBackdrop(attributes) {
  const opacity = Number(attributes["fill-opacity"]);
  return (
    attributes["fill-opacity"] !== undefined &&
    opacity <= 0.01 &&
    attributes.stroke === undefined &&
    attributes["stroke-width"] === undefined
  );
}

/** One attribute of one element, as JSX. */
function jsxAttribute(key, value, used) {
  if (key === "stroke" || key === "fill") {
    if (value === "none") return `${key}="none"`;
    const slot = SLOTS[value];
    if (slot === undefined) throw new Error(`没见过的颜色 ${key}="${value}"`);
    return `${key}={c[${slot}]}`;
  }
  if (key === "stroke-width") {
    used.strokeWidth = true;
    return "strokeWidth={strokeWidth}";
  }
  if (key === "stroke-linecap") {
    used.strokeLinecap = true;
    return "strokeLinecap={strokeLinecap}";
  }
  if (key === "stroke-linejoin") {
    used.strokeLinejoin = true;
    return "strokeLinejoin={strokeLinejoin}";
  }
  if (key === "id" || key === "style" || key === "mask") {
    throw new Error(`${key} 还没支持：先把 icons-build.mjs 补上再收这个图标`);
  }
  // 其余属性按 React 的写法原样给：fill-rule → fillRule、fill-opacity → fillOpacity…
  return `${key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}="${value}"`;
}

/** The children of the source `<svg>`, as JSX. */
function toJsx(svg, used) {
  const inner = svg
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>[\s\S]*$/, "");
  if (/<(defs|mask|clipPath|filter|symbol|use)\b/.test(inner)) {
    throw new Error("这个图标带 defs / mask / clipPath：icons-build 还没支持，先别收");
  }

  const lines = [];
  let depth = 3;
  const tokens = inner.matchAll(
    /<(\/?)([a-zA-Z][\w]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g,
  );
  for (const [, closing, tag, attributeText, selfClosing] of tokens) {
    if (closing) {
      depth -= 1;
      lines.push(`${"  ".repeat(depth)}</${tag}>`);
      continue;
    }
    const attributes = {};
    for (const [, key, value] of attributeText.matchAll(
      /([\w:-]+)="([^"]*)"/g,
    )) {
      attributes[key] = value;
    }
    if (isBackdrop(attributes)) continue;

    const rendered = Object.entries(attributes).map(([key, value]) =>
      jsxAttribute(key, value, used),
    );
    const head = rendered.length
      ? `<${tag} ${rendered.join(" ")}`
      : `<${tag}`;
    if (selfClosing) {
      lines.push(`${"  ".repeat(depth)}${head} />`);
      continue;
    }
    lines.push(`${"  ".repeat(depth)}${head}>`);
    depth += 1;
  }
  return lines;
}

// A machine without the sibling checkout can still build — the generated file is
// committed. Only someone adding an icon needs the sources.
const haveSources = await fs.access(sourceDir).then(
  () => true,
  () => false,
);
if (!haveSources) {
  if (check) {
    console.log(
      `icons:check 跳过 —— ${parkDir} 不在本机（生成物已提交，构建不需要它）`,
    );
    process.exit(0);
  }
  console.error(
    `找不到图标源 ${parkDir}：先把 myIconpark 放到仓库旁边，或用 MYICONPARK_DIR 指过去。`,
  );
  process.exit(1);
}

const names = await wantedNames();
const glyphs = [];
for (const name of names) {
  const svg = await fs.readFile(await findSource(name), "utf8");
  const used = { strokeWidth: false, strokeLinecap: false, strokeLinejoin: false };
  const body = toJsx(svg, used);
  const params = [
    "c",
    ...(used.strokeWidth ? ["strokeWidth"] : []),
    ...(used.strokeLinecap ? ["strokeLinecap"] : []),
    ...(used.strokeLinejoin ? ["strokeLinejoin"] : []),
  ];
  glyphs.push(
    [
      `  "${name}": ({ ${params.join(", ")} }) => (`,
      "    <>",
      ...body,
      "    </>",
      "  ),",
    ].join("\n"),
  );
}

const header = `/**
 * 由 \`scripts/icons-build.mjs\` 从 myIconpark 的 svg 生成 —— 不要手改这一个文件。
 *
 * 改图标：去 ${path.relative(root, parkDir)}/source 改（或加）svg，再跑 \`pnpm icons:build\`。
 * 改粗细／圆角／配色：\`src/config/icon-runtime.tsx\`，所有图标一起跟着变；哪个语义名用
 * 哪个图标：\`src/config/icons.json\`。
 *
 * 颜色按 IconPark 的四个槽来：c[0] 外描边、c[1] 外填充、c[2] 内描边（遮罩那块底）、
 * c[3] 内填充；槽里的具体颜色由主题决定（见 icon-runtime 的 \`colorsFor\`）。
 */
import type { Glyph } from "./icon-runtime"

export const glyphs = {
${glyphs.join("\n")}
} satisfies Record<string, Glyph>
`;

const current = await fs.readFile(outFile, "utf8").catch(() => null);
if (check) {
  if (current === header) {
    console.log(`icons:check ok — ${names.length} 个图标和 myIconpark 一致`);
    process.exit(0);
  }
  console.error(
    "icons:check 失败：src/config/icon-glyphs.tsx 不是最新的，跑 pnpm icons:build",
  );
  process.exit(1);
}
if (current === header) {
  console.log(`icons:build ok — ${names.length} 个图标，没有变化`);
  process.exit(0);
}
await fs.writeFile(outFile, header);
console.log(
  `icons:build ok — 写好 ${names.length} 个图标：${path.relative(root, outFile)}`,
);
