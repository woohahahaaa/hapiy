---
slug: header-rewrite
status: drafting
intent: clear
pending-action: write .omo/plans/header-rewrite.md
approach: extend rewrite engine to operate on HTTP headers alongside body, gated by path prefix `header.*` and an explicit `scope` field on each op; reuse existing mode/path/value/conditions DSL verbatim so existing rules keep working.
---

# Draft: header-rewrite

## Components (topology ledger)
<!-- One row per top-level component that can succeed or fail independently. -->
| id | outcome (one line) | status | evidence path |
| --- | --- | --- | --- |
| C1 | Backend engine: rewrite chains can mutate header KV via `header.*` path prefix | active | `project/backend/internal/relay/rewrite.go`, `project/backend/internal/relay/engine.go:240-281`, `project/backend/internal/relay/topology_plan.go:117-132` |
| C2 | Op-level `scope` field gates per-op target (header / body / all) | active | `project/backend/internal/relay/rewrite.go:25-34` (RewriteOp struct) |
| C3 | Frontend rewrite rule dialog gains an optional scope selector + doc link | deferred — only DSL fields matter for engine; UI selector nice-to-have but not blocking engine correctness | `project/web/src/pages/PolicyPage.tsx:378-407` |

## Open assumptions (announced defaults)
| assumption | adopted default | rationale | reversible? |
| --- | --- | --- | --- |
| Path prefix discriminator | `header.<Header-Name>` only (no `Header.` / `HEADERS.` aliases) | Keep one canonical form to avoid gjson path-parser confusion (gjson's `Header` may parse as a literal key); user-facing ergonomics matter more than flexibility | Yes — can add aliases later |
| Default scope when omitted | `"all"` (no filtering) | Backwards-compatible: existing rules without `scope` field keep running on body only when path doesn't start with `header.` | Yes — field is optional in JSON |
| Scope ↔ path mismatch behavior | **Compile-time error** (rule fails to load, surfaced in `populateAssignment`) | Matches existing fail-loud style in `compileRewriteChain`; silent skipping hides authoring bugs in production | Yes — can relax later |
| Header path is read top-level only | No support for nested keys (`header.Set-Cookie.0`) | Headers are flat KV; nested gjson syntax would mislead users | Yes — not exposed |
| Header value type | String only (raw string, no JSON encoding) | Matches user intent ("对 header 进行无差别处理" — directly mutate http.Header); gjson's `.String()` returns the raw string with no escaping, perfect for header values | Yes |
| Set-Cookie multi-value | **DEFERRED** — `map[string]string` stays single-valued for now; Set-Cookie 多值作为 follow-up owner-decision | Current `RelayRequest.Headers` / `RelayResponse.Headers` is `map[string]string`. Changing to `[]string` would touch every handler that reads headers. Single-value is enough for the 95% case (X-Request-ID, Authorization, X-Route, X-Tenant, Content-Type, etc.) | Yes — but needs data-struct migration |
| `ensure_prefix` / `ensure_suffix` / `append` / `prepend` semantics on header | Same as body: `ensure_prefix` checks current value's prefix, `append` reads current then concats | Reuses existing semantic; "对 header 无差别处理" means header goes through the same op pipeline | Yes |
| Conditions evaluate on body only | Path `header.X-Foo` in a condition reads from header map; default (no `header.` prefix) reads from body | Condition paths follow the same discriminator; no need to flag conditions separately | Yes |
| Mode `replace` / `regex_replace` / `move` / `copy` on header | Supported for header scope; `move`/`copy` use `header.X-Src` → `header.X-Dst` syntax (no cross-scope, no JSON body) | Reuses same DSL; "无差别" extends to these modes too | Yes |

## Findings (cited - path:lines)

- **Rewrite engine entry points** — `applyRewriteChains(body []byte, chains []CompiledRewriteChain) ([]byte, error)` at `rewrite.go:238`. Body is JSON bytes; chains iterate ops with cheap sjson local replacement.
- **Op structure** — `RewriteOp` struct at `rewrite.go:25-34` has `Mode`, `Path`, `Value`, `From`, `To`, `Regex`, `DstPath`, `Conditions`. No header awareness.
- **Call sites** — `topology_plan.go:117` (request) and `topology_plan.go:128` (response) compile the chain into `plan.CompiledRewrite` / `plan.CompiledResponseRewrites`. `engine.go:245` runs request apply, `engine.go:271` runs response apply.
- **Request/Response Header types** — `RelayRequest.Headers map[string]string` at `engine.go:140`. `RelayResponse.Headers map[string]string` at `engine.go:146`. Both **single-valued** — no support for repeated headers like Set-Cookie. (Confirmed: `Headers` is `map[string]string`, NOT `http.Header`.)
- **Existing condition ops** — `contains / prefix / suffix / eq / neq / gt / gte / lt / lte / matches` at `rewrite.go:204`. hapiy extends new-api with `eq / neq / matches` (3 ops total).
- **Frontend rule entry point** — `PolicyPage.tsx:378-407` shows `RewriteForm` with a single `script` Textarea where users paste a JSON array. Frontend stores script as-is; backend compiles it.
- **Frontend rule type** — `parseRewriteRule` at `dashboard-api.ts:528-536` reads `{id, name, script, status}`. No scope field yet.
- **DB model** — `RewriteRule` and `ResponseRewriteRule` at `models.go:102-129` both have `id, name, script, status`. No scope field stored — scope is **inside the script JSON** (per-op), not at the rule level. This matches new-api's convention where scope is per-op.

## Decisions (with rationale)

### D1: Add `Scope` field per op (not per rule)
- Where: `RewriteOp.Scope string` with json tag `scope,omitempty`
- Why per-op not per-rule: A rule may mix body rewrites and header rewrites (e.g., one op sets a header, another op rewrites a body field, gated by the same condition). Per-op scope gives finer control.
- Validation: When `scope` is `"header"`, path MUST start with `header.`; when `scope` is `"body"`, path MUST NOT start with `header.`; when `scope` is `""` or `"all"`, both allowed.
- Compile-time check in `compileRewriteOp` so a bad rule fails at plan-build, not at request time.

### D2: Discriminate at `applyRewriteOp` by path prefix
- NOT via gjson custom modifier — modifier would still let gjson mutate the JSON tree (e.g., `sjson.SetBytes(body, "header.X", v)` would create a literal `"header"` key in the body). We must short-circuit **before** any gjson/sjson call.
- Decision: in `applyRewriteOp`, check `strings.HasPrefix(op.Path, "header.")` first; if true, route to header branch; otherwise existing body branch.

### D3: Extend `applyRewriteChains` signature
- New signature: `applyRewriteChains(body []byte, headers map[string]string, chains []CompiledRewriteChain) ([]byte, map[string]string, error)`
- Callers (`engine.go:245`, `engine.go:271`) pass `req.Headers` / `resp.Headers` (which are already `map[string]string`).

### D4: Conditions also discriminate by path prefix
- `RewriteCondition.Path` follows same rule: `header.X` reads from header map; everything else from body.
- Same `evaluateCondition` function gains a `headers map[string]string` parameter; routes the same way.

### D5: Default scope semantics = "all" (no filtering)
- Existing rules (no scope field) keep working unchanged.
- Empty/missing `scope` in JSON = `"all"`.
- This preserves backward compatibility for every rule currently in the DB.

### D6: UI is a follow-up, not blocking
- Frontend textarea accepts arbitrary JSON; users can already write `{"path":"header.X-Foo","mode":"set","value":"vip","scope":"header"}` by hand.
- A scope selector dropdown in `RewriteForm` is nice-to-have but not required for engine correctness. We add it if time permits; the plan defers it to keep the patch tight.

## Scope IN

- `RewriteOp.Scope string` field with json tag, parsed in `compileRewriteOp`, validated against path prefix.
- New branch in `applyRewriteOp`: header path → mutate `map[string]string` via existing mode semantics (set / delete / append / prepend / ensure_prefix / ensure_suffix / trim_prefix / trim_suffix / trim_space / to_lower / to_upper / replace / regex_replace). Modes `copy` / `move` stay body-only (cross-scope is unclear semantics).
- `applyRewriteChains` signature change (body + headers).
- `applyCompiledRewriteRules` and `applyCompiledResponseRewriteRules` pass `req.Headers` / `resp.Headers`.
- Conditions (`evaluateCondition`) gain header discrimination for their `Path` field.
- Unit tests: header set / delete / append / prepend / replace; condition on header path; scope/path mismatch compile error; existing body-only tests still pass.

## Scope OUT (Must NOT have)

- `copy` / `move` across header↔body (e.g., move body.model → header.X-Model). Different data structures; user can do it with two ops if needed.
- Set-Cookie multi-value. Defer until owner explicitly approves the map-type migration.
- Header path nesting (`header.Set-Cookie.0`). Headers are flat.
- Per-rule scope field. Per-op only.
- Modifying `RelayRequest.Headers` type from `map[string]string` to `http.Header`. Avoid blast radius.
- Touching rewrite_test.go's existing body-only tests' assertions. They should pass without edits.

## Open questions (resolved)

- **Q1 RESOLVED**: Set-Cookie multi-value — **DEFER indefinitely**. User clarified: Set-Cookie is only received from upstream; user has no need to modify upstream-returned headers in this round. `RelayRequest.Headers` / `RelayResponse.Headers` stay `map[string]string`. Multi-value is a non-goal for now; if ever needed, it'd be a separate workstream.
- **Q2 default adopted**: Both `""` and `"all"` accepted, normalized to `"all"` at compile. Simpler for users.
- **Q3 default adopted**: UI scope selector deferred. Users write JSON by hand; no `PolicyPage.tsx` change this round.

## Approval gate
status: awaiting-approval
<!-- All forks resolved: Q1 deferred (user clarified scope of need), Q2/Q3 default adopted. -->
<!-- pending-action: write .omo/plans/header-rewrite.md -->
