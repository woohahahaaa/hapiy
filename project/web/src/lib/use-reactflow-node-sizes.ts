import { useCallback, useEffect, useRef, useState } from 'react'

export type NodeSize = { width: number; height: number }

export type NodeSizeMap = ReadonlyMap<string, NodeSize>

/**
 * Measure a ReactFlow node wrapper element in **flow-space** coordinates.
 *
 * `offsetWidth` / `offsetHeight` are CSS-layout dimensions that are **not**
 * affected by CSS transforms. React Flow applies zoom as a `transform: scale()`
 * on `.react-flow__viewport`, so `getBoundingClientRect()` would return the
 * scaled (visual) size while `offset*` returns the unscaled flow-space size.
 * Using `offset*` guarantees the wand produces identical coordinates at any
 * zoom level.
 */
export function measureNodeElement(el: Element): NodeSize | null {
  const html = el as HTMLElement
  const width = html.offsetWidth
  const height = html.offsetHeight
  if (width === 0 && height === 0) return null
  return { width, height }
}

// Observe every `.react-flow__node` under `container` and write its measured
// flow-space size into the returned ref's `current` map. Each ReactFlow node DOM
// carries `data-id` (set by ReactFlow when rendering), which we use as the key.
//
// Returns `[setContainer, sizesRef]` where `setContainer` is a callback ref
// to attach to the ReactFlow wrapper div. Using a callback ref (backed by
// useState) ensures the effect re-runs when the container element appears or
// disappears — critical because the container is not rendered during loading.
export function useReactFlowNodeSizes(): [
  React.RefCallback<HTMLElement>,
  React.RefObject<Map<string, NodeSize>>,
] {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const sizesRef = useRef<Map<string, NodeSize>>(new Map())

  useEffect(() => {
    if (!container) return

    const sync = (el: Element) => {
      const id = el.getAttribute('data-id')
      if (!id) return
      const size = measureNodeElement(el as HTMLElement)
      if (size) sizesRef.current.set(id, size)
    }

    const observed = new Map<Element, ResizeObserver>()
    const scan = () => {
      const nodes = container.querySelectorAll('.react-flow__node')
      for (const node of Array.from(nodes)) {
        if (!observed.has(node)) {
          const ro = new ResizeObserver(() => sync(node))
          ro.observe(node)
          observed.set(node, ro)
        }
        sync(node)
      }
    }

    const mo = new MutationObserver(scan)
    mo.observe(container, { childList: true, subtree: true })

    // Repeat the initial scan for ~1s because ReactFlow mounts nodes
    // asynchronously (HMR, lazy fit-view, etc.). Without retries the first
    // auto-layout click lands before sizes are populated.
    scan()
    const retryStart = performance.now()
    const retry = () => {
      scan()
      if (performance.now() - retryStart < 1000) requestAnimationFrame(retry)
    }
    requestAnimationFrame(retry)

    return () => {
      mo.disconnect()
      for (const ro of observed.values()) ro.disconnect()
      observed.clear()
    }
  }, [container])

  const refCallback = useCallback((el: HTMLElement | null) => {
    setContainer(el)
  }, [])

  return [refCallback, sizesRef]
}
