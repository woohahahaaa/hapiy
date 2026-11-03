import { describe, expect, it } from "vitest"
import { withPreservedSelection } from "./flow-selection"

const node = (id: string, selected = false) => ({ id, selected })

describe("withPreservedSelection", () => {
  it("keeps the selection of nodes that still exist after a rebuild", () => {
    const next = [node("a"), node("b"), node("c")]
    expect(withPreservedSelection(next, new Set(["a"]))).toEqual([
      node("a", true),
      node("b"),
      node("c"),
    ])
  })

  it("keeps every selected node when several are selected", () => {
    const next = [node("a"), node("b"), node("c")]
    expect(
      withPreservedSelection(next, new Set(["a", "b"])).map(
        (n) => n.selected ?? false
      )
    ).toEqual([true, true, false])
  })

  it("drops selections of nodes removed from the graph", () => {
    const next = [node("a")]
    expect(withPreservedSelection(next, new Set(["a", "removed"]))).toEqual([
      node("a", true),
    ])
  })

  it("never selects a node the user did not select", () => {
    const next = [node("a"), node("b")]
    expect(withPreservedSelection(next, new Set(["b"]))).toEqual([
      node("a"),
      node("b", true),
    ])
  })

  it("returns the rebuilt list untouched when nothing is selected", () => {
    const next = [node("a"), node("b")]
    expect(withPreservedSelection(next, new Set())).toBe(next)
  })

  it("works for edges too", () => {
    const next = [{ id: "e1" }, { id: "e2" }]
    expect(withPreservedSelection(next, new Set(["e1"]))).toEqual([
      { id: "e1", selected: true },
      { id: "e2" },
    ])
  })
})
