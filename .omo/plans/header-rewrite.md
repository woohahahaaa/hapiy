# header-rewrite - Work Plan

## TL;DR (For humans)

**What you'll get:** 你写规则时可以用 `path: "header.X-Foo"` 这种写法，**直接改请求/响应的 HTTP header**，语法跟现在改 body 完全一致——同一套 `mode/path/value/conditions` DSL，多一个可选的 `scope` 字段（`header` / `body` / `all`）让规则作者声明这条 op 只改 header 或只改 body。

**Why this approach:** 直接在 `applyRewriteOp` 里按 path 前缀分派（不走 gjson 自定义 modifier）——避免 sjson 真的在 JSON body 里创建一个叫 `"header"` 的字段。同时复用现有 mode 语义（set/delete/append/prepend/trim_*/ensure_*/replace/regex_replace 等），用户感知不到 header 和 body 的差别。

**What it will NOT do:**
- 不支持 Set-Cookie 这种**同名多次**的 header（你需要的是改**自己一侧**注入的鉴权/路由/追踪 header，不是改上游返回的 Set-Cookie）
- 不支持 `copy` / `move` 跨 body ↔ header（一次 op 内只动一类数据）
- 不动 `PolicyPage.tsx` 的弹窗 UI（用户可以手写 JSON 加 `scope` 字段）

**Effort:** Short
**Risk:** Low - 改动收敛在 `rewrite.go` + `engine.go` 两个文件，已有 `compileRewriteChains` 编译期校验机制兜底
**Decisions to sanity-check:**
- `header.` 前缀作为唯一识别符（大小写敏感，跟 gjson 路径解析规则一致）
- 缺省 `scope` 等价于 `scope: "all"`（向后兼容现有所有规则）

Your next move: approve, or ask for high-accuracy review first.

---

> TL;DR (machine): Short effort, Low risk; extends `RewriteOp` with `Scope` field; routes by path prefix; rewires `applyRewriteChains` and `engine.go` call sites; unit-tested.

## Scope

### Must have
- `RewriteOp.Scope string` field with `json:"scope,omitempty"` tag, parsed in `compileRewriteOp`.
- Compile-time validation: `scope=header` requires `header.` path prefix; `scope=body` forbids it; `scope=all` (or empty) accepts either. Mismatch → error containing rule id and op index.
- `applyRewriteOp(body, headers, op)` — discriminated by `strings.HasPrefix(op.Path, "header.")`. Header branch reads/writes `map[string]string`. Body branch unchanged.
- Header modes supported: `set / delete / append / prepend / ensure_prefix / ensure_suffix / trim_prefix / trim_suffix / trim_space / to_lower / to_upper / replace / regex_replace`.
- `copy / move` on header scope return a clear error (cross-scope not supported).
- `applyRewriteChains(body, headers, chains)` signature; returns updated body, headers, error.
- `evaluateCondition(cond, body, headers)` extended with `headers`; condition path `header.X` reads from header map.
- Engine call sites: `applyCompiledRewriteRules` passes `req.Headers`; `applyCompiledResponseRewriteRules` passes `resp.Headers`.
- Unit tests in `rewrite_test.go` covering: header set/delete/append/prepend/trim/replace/regex_replace; condition path `header.X`; scope/path compile errors; existing body-only tests still pass.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- Do NOT touch `RelayRequest.Headers` / `RelayResponse.Headers` types. Stay `map[string]string`.
- Do NOT add `set_header` / `delete_header` modes. The whole point of this design is path-prefix-based unification.
- Do NOT add per-rule `scope`. Scope is per-op.
- Do NOT add Set-Cookie multi-value support.
- Do NOT modify `PolicyPage.tsx` UI (deferred; users type JSON by hand).
- Do NOT change `RewriteRule` / `ResponseRewriteRule` DB schema. Scope lives in script JSON.
- Do NOT silently skip mismatched scope/path. Fail loud at compile.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: tests-after, in `rewrite_test.go` using existing Go test patterns. Add new `TestRewriteHeader*` and `TestRewriteScope*` test functions; do not modify existing body-only tests.
- Build: `cd project/backend && go build ./... && go test ./...`
- Live integration: spin backend on :8080, hit a test endpoint, verify the outgoing request's `X-Route` header matches what the rule set. Evidence in `.omo/evidence/task-N-header-rewrite/`.
- Final verification wave: see below.

## Execution strategy

### Parallel execution waves
> Three waves. Wave 1 is the structural change (sequential because all edits to the same file). Wave 2 splits mode implementations (parallel — different functions). Wave 3 wiring + tests + docs.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| T1 Scope field + compile validation | — | T2 | — |
| T2 applyRewriteOp + applyRewriteChains signature + nil-guard | T1 | T3, T4 | — |
| T3 Header mode implementations (13 modes) | T2 | T5 | T4 |
| T4 Condition header path support + caller updates | T2 | T5 | T3 |
| T5 engine.go call sites wire-up | T3, T4 | T6, T8 | — |
| T6 Unit tests (modes + scope + conditions + engine wiring) | T5 | T7 | — |
| T7 Backend build + go test verification | T6 | T9 | T8 |
| T8 Docs update (rewrite-ops.md) | T5 | T9 | T7 |
| T9 Live integration test (httptest.Server capture) | T7, T8 | Final wave | — |

## Todos
> Implementation + Test = ONE todo. Never separate.

- [x] 1. **RewriteOp.Scope field + compile-time validation**
  What to do / Must NOT do:
  - Add `Scope string` field to `RewriteOp` struct in `rewrite.go:25-34` with `json:"scope,omitempty"` tag.
  - In `compileRewriteOp` (rewrite.go:74-155): after parsing all op fields, if `entry["scope"]` is present, unmarshal it; lowercase + trim; accept `""`, `"all"`, `"header"`, `"body"`; reject other values.
  - After parsing scope, validate `scope` vs `path` prefix: `scope="header"` requires `strings.HasPrefix(path, "header.")`; `scope="body"` requires `!strings.HasPrefix(path, "header.")`; `scope="all"` (or empty) accepts either. On mismatch, return error like `rule %s op %d: scope %q incompatible with path %q`.
  - Do NOT yet change `applyRewriteOp` signature — that's T2.
  - Do NOT touch `engine.go` yet — that's T5.

  Parallelization: Wave 1 (sequential) | Blocked by: — | Blocks: T2

  References (executor has NO interview context - be exhaustive):
  - `project/backend/internal/relay/rewrite.go:25-34` — RewriteOp struct
  - `project/backend/internal/relay/rewrite.go:74-155` — compileRewriteOp function
  - `project/backend/internal/relay/rewrite.go:147-153` — existing conditions parsing pattern (reference for how to parse optional fields)

  Acceptance criteria (agent-executable):
  - `go build ./...` succeeds.
  - New helper unit test: compileRewriteChain accepts `{"path":"header.X","mode":"set","value":"v","scope":"header"}` without error; rejects `{"path":"model","mode":"set","value":"x","scope":"header"}` with "scope header incompatible with path model".
  - New helper unit test: `{"path":"model","mode":"set","value":"x","scope":"body"}` accepted; `{"path":"header.X","mode":"set","value":"v","scope":"body"}` rejected.

  QA scenarios (name the exact tool + invocation): happy + failure, Evidence `.omo/evidence/task-1-header-rewrite/test.log`
  - Happy: compile script with `scope: "header"` and `path: "header.X-Foo"` → no error.
  - Failure: compile script with `scope: "header"` and `path: "model"` → error contains "incompatible".
  - Failure: compile script with `scope: "invalid_value"` → error contains "unsupported scope".

  Commit: Y | `feat(relay): add Scope field to RewriteOp with compile-time validation`

- [x] 2. **applyRewriteOp signature change + applyRewriteChains caller wiring (single coherent change)**
  What to do / Must NOT do:
  - Change `applyRewriteOp(body []byte, op *RewriteOp) ([]byte, error)` to `applyRewriteOp(body []byte, headers map[string]string, op *RewriteOp) ([]byte, map[string]string, error)`.
  - At the very top of the function, add `if strings.HasPrefix(op.Path, "header.") { return applyHeaderOp(headers, op) }`.
  - `applyHeaderOp` is a NEW function with signature `applyHeaderOp(headers map[string]string, op *RewriteOp) ([]byte, map[string]string, error)`. In this todo, ONLY scaffold it as `return body, headers, fmt.Errorf("header op %q not yet implemented (TODO T3)", op.Mode)` — full implementation lands in T3.
  - The body branch (else clause) keeps the original logic but now also returns `headers` unchanged. EVERY existing `return` statement in the body branch gains the `headers` return value (there are ~20 return sites from `sjson.SetBytes`/`gjson` etc. — all become `return X, headers, nil`).
  - **CRITICAL** — this todo MUST also update `applyRewriteChains` (rewrite.go:238) signature to `applyRewriteChains(body []byte, headers map[string]string, chains []CompiledRewriteChain) ([]byte, map[string]string, error)`, AND update its loop body: `ok, err := evaluateConditions(op.Conditions, body)` stays OLD signature (T4 extends it); `updated, headers, err := applyRewriteOp(body, headers, op)` uses the NEW signature. Without the signature change, `go build ./...` fails after T2.
  - **CRITICAL — build must stay green across tests**: `applyRewriteChains` has TEN call sites that ALL break on this signature change and MUST be updated in THIS todo:
    - `project/backend/internal/relay/engine.go:245` → `applyRewriteChains(raw, nil, plan.CompiledRewrite)` and `engine.go:271` → `applyRewriteChains(body, nil, plan.CompiledResponseRewrites)`. Pass `nil` here — wiring real `req.Headers`/`resp.Headers` is T5. This is the ONLY engine.go touch in T2.
    - `project/backend/internal/relay/rewrite_test.go:59,91,123,131,153,161,179,201` (8 sites) → add `nil` as the second argument: `applyRewriteChains(body, nil, []CompiledRewriteChain{...})`. Do NOT change any assertions — mechanical signature adaptation only. T6 adds NEW test functions and must NOT modify these existing calls.
  - **CRITICAL** — add the nil-map guard inside the loop of `applyRewriteChains`, per chain: `if headers == nil && chainHasHeaderOp(chain) { headers = map[string]string{} }`. `chainHasHeaderOp` is a small helper: iterate `chain.Ops`, return true if any `strings.HasPrefix(op.Path, "header.")`.
  - In THIS todo, add the two minimal unit tests (they prove the routing + nil-guard work): `TestRewriteHeaderRoutingStub` (path `header.X-Foo` mode `set` → error contains "not yet implemented") and `TestRewriteChainsNilGuard` (nil body + nil headers + chain with a `header.*` op → headers initialized, no panic, error from stub). Full test matrix lands in T6.
  - Do NOT implement mode logic yet — that's T3.
  - Do NOT change `evaluateConditions`/`evaluateCondition`/`evaluateCombined` signatures — that's T4.
  - Do NOT wire `req.Headers`/`resp.Headers` in engine.go — that's T5.

  Parallelization: Wave 1 (sequential) | Blocked by: T1 | Blocks: T3, T4

  References:
  - `project/backend/internal/relay/rewrite.go:260-360` — current applyRewriteOp (every return site gains `headers`)
  - `project/backend/internal/relay/rewrite.go:238-258` — current applyRewriteChains (must update together)
  - `project/backend/internal/relay/engine.go:245,271` — the two production call sites (pass nil in T2)
  - `project/backend/internal/relay/rewrite_test.go:59,91,123,131,153,161,179,201` — the eight test call sites (mechanical `nil` arg)

  Acceptance criteria (agent-executable):
  - `go build ./...` succeeds.
  - `go test ./internal/relay/...` succeeds — existing body-only tests still pass after the mechanical call-site updates (headers arg nil; map never touched in body branch).
  - `TestRewriteHeaderRoutingStub` passes: path `header.X-Foo` mode `set` → error contains "not yet implemented" (proves routing works).
  - `TestRewriteChainsNilGuard` passes: nil body + nil headers + chain containing `header.*` op → headers becomes initialized map; no panic.

  QA scenarios (name the exact tool + invocation): happy + failure, Evidence `.omo/evidence/task-2-header-rewrite/test.log`
  - Happy: `{"path":"messages.0.role","mode":"set","value":"user"}` → body mutated, headers unchanged.
  - Routing check: `{"path":"header.X-Foo","mode":"set","value":"v"}` → returns "not yet implemented" error from T3 stub.
  - Nil-guard: `applyRewriteChains(nil_body, nil_headers, chainWithHeaderOp)` → headers initialized, error from stub.
  - Regression: `go test ./internal/relay/...` passes with all 8 existing call sites mechanically adapted.

  Commit: Y | `refactor(relay): extend applyRewriteOp and applyRewriteChains signatures with headers`

- [x] 3. **Header mode implementations (13 modes)**
  What to do / Must NOT do:
  - Replace T2's stub `applyHeaderOp` with full implementation. All 13 modes go through a single switch on `op.Mode`.
  - Helper: `headerKey(op.Path) string` — strips `header.` prefix and returns the rest (e.g., `header.X-Foo` → `X-Foo`). If prefix missing, return error.
  - Mode implementations (mirror body semantics, operate on string value):
    - `set`: `headers[key] = op.Value`
    - `delete`: `delete(headers, key)`
    - `append`: `headers[key] += op.Value` (matches body semantics where missing path becomes empty)
    - `prepend`: `headers[key] = op.Value + headers[key]`
    - `ensure_prefix`: if `strings.HasPrefix(headers[key], op.Value)` noop; else `headers[key] = op.Value + headers[key]`
    - `ensure_suffix`: mirror
    - `trim_prefix` / `trim_suffix`: standard
    - `trim_space` / `to_lower` / `to_upper`: standard
    - `replace`: `strings.ReplaceAll(headers[key], op.From, op.To)`
    - `regex_replace`: `op.Regex.ReplaceAllString(headers[key], op.To)`
  - Modes `copy` and `move`: return error `header scope: copy/move not supported (cross-scope rewrite is not allowed)`.
  - All modes MUST return `body, headers, nil` on success — body unchanged.
  - Do NOT change `evaluateCondition` — that's T4.

  Parallelization: Wave 2 | Blocked by: T2 | Blocks: T5

  References:
  - `project/backend/internal/relay/rewrite.go:262-359` — body-mode semantics to mirror
  - Go stdlib `strings.HasPrefix` / `HasSuffix` / `ReplaceAll` / `TrimSpace` / `ToLower` / `ToUpper`

  Acceptance criteria (agent-executable):
  - `go build ./...` succeeds.
  - Unit test matrix: 13 modes × happy path = 13 test cases in `rewrite_test.go`.
  - Body returned unchanged across all 13 modes.

  QA scenarios (name the exact tool + invocation): happy + failure, Evidence `.omo/evidence/task-3-header-rewrite/test.log`
  - For each of 13 modes: input header set `{"X-Foo":"hello world"}`, op sets expected value, output matches.
  - Failure: `{"path":"header.X-Foo","mode":"copy","dst":"header.X-Bar"}` → error contains "copy/move not supported".

  Commit: Y | `feat(relay): implement 13 header modes mirroring body semantics`

- [x] 4. **evaluateCondition header path support (with all caller updates)**
  What to do / Must NOT do:
  - Change `evaluateCondition(c *RewriteCondition, body []byte) (bool, error)` to `evaluateCondition(c *RewriteCondition, body []byte, headers map[string]string) (bool, error)`.
  - At top: `if strings.HasPrefix(c.Path, "header.") { return evaluateHeaderCondition(c, headers) }`.
  - `evaluateHeaderCondition`: extract key via `headerKey(c.Path)`, get `actual := headers[key]` (empty if missing), then run `compareValues(c.Op, actual, c.Value)` — same comparison function as body, no need to duplicate.
  - For `matches`: use `c.Regex.MatchString(actual)`. The regex is already compiled in `compileConditionLeaf`.
  - **CRITICAL** — update ALL callers of `evaluateCondition`:
    - `evaluateConditions` (rewrite.go:363): gains `headers` param, passes through in the loop
    - `evaluateCombined` (rewrite.go:408): gains `headers` param, passes through in its recursive `evaluateCondition` call
    - `applyRewriteChains` loop (rewrite.go:243): the call `ok, err := evaluateConditions(op.Conditions, body)` — T2 deliberately left this at the OLD signature; T4 MUST update it to `evaluateConditions(op.Conditions, body, headers)`. This is the ONE line to touch in applyRewriteChains.
  - Update `applyRewriteOp` and `applyHeaderOp` (already in rewrite.go) to pass their `headers` arg through to `evaluateConditions`.
  - Do NOT change `compareValues` (already generic).
  - Do NOT touch any other part of `applyRewriteChains` — only the evaluateConditions call line above.

  Parallelization: Wave 2 (parallel with T3 — both blocked by T2, different functions) | Blocked by: T2 | Blocks: T5

  References:
  - `project/backend/internal/relay/rewrite.go:379-406` — current evaluateCondition
  - `project/backend/internal/relay/rewrite.go:408-435` — evaluateCombined (recursive caller; MUST update)
  - `project/backend/internal/relay/rewrite.go:439-477` — compareValues (reuse as-is)
  - `project/backend/internal/relay/rewrite.go:363-377` — evaluateConditions wrapper

  Acceptance criteria (agent-executable):
  - `go build ./...` succeeds.
  - Unit test: condition `{"path":"header.X-Foo","op":"eq","value":"vip"}` evaluates true when `headers["X-Foo"]="vip"`, false otherwise.
  - Unit test: condition `{"path":"header.X-Foo","op":"matches","value":"^Bearer "}` works against header value.
  - Unit test: nested AND/OR condition with mixed body + header paths evaluates correctly.
  - Existing body-condition tests still pass.

  QA scenarios (name the exact tool + invocation): happy + failure, Evidence `.omo/evidence/task-4-header-rewrite/test.log`
  - Happy: `{"path":"header.X-Route","op":"eq","value":"premium"}` with `headers["X-Route"]="premium"` → true.
  - Happy: `{"path":"header.X-Route","op":"matches","value":"^premium$"}` with `headers["X-Route"]="premium-tier"` → false (regex anchored).
  - Nested: AND of `[{"path":"model","op":"eq","value":"gpt-4"},{"path":"header.X-Tenant","op":"neq","value":"free"}]` evaluates correctly with mixed body+header.

  Commit: Y | `feat(relay): evaluate conditions on header path when prefix is header.`

- [x] 5. **engine.go call sites: pass req.Headers / resp.Headers through applyRewriteChains**
  What to do / Must NOT do:
  - Caller `applyCompiledRewriteRules` (engine.go:240-257): change call from `applyRewriteChains(raw, plan.CompiledRewrite)` to `applyRewriteChains(raw, req.Headers, plan.CompiledRewrite)`; write `req.Headers = updatedHeaders` from the returned map.
  - Caller `applyCompiledResponseRewriteRules` (engine.go:262-281): same change with `resp.Headers`.
  - **Request-side note (verified in handler/relay.go:49-55)**: production always fills `req.Headers` from `c.Request.Header`, so it is non-nil; the returned `updatedHeaders` is the SAME map (header ops mutate in place, body-only chains return it unchanged), so `req.Headers = updatedHeaders` is a safe no-op write-back.
  - **Response-side ordering (CRITICAL, engine.go:271-279)**: the existing code does `resp.Body = io.NopCloser(...)`, then `if resp.Headers == nil { resp.Headers = map[string]string{} }`, then `resp.Headers["Content-Length"] = ...`. Keep this exact order: capture `updated, updatedHeaders, err := applyRewriteChains(body, resp.Headers, ...)`, then write back `resp.Headers = updatedHeaders` BEFORE the existing nil-check + Content-Length set. `updatedHeaders` is nil only when `resp.Headers` was nil AND no header op ran; the existing `if resp.Headers == nil` guard then handles it exactly as today.
  - Note: defensive nil-map initialization was already added in T2's `applyRewriteChains`, so engine.go does NOT need additional nil checks — but DO verify by reading the file post-T2.
  - Do NOT change `RelayRequest.Headers` type. Stay `map[string]string`.
  - Do NOT write any tests in this todo; tests land in T6.

  Parallelization: Wave 3 | Blocked by: T3, T4 | Blocks: T6, T8

  References:
  - `project/backend/internal/relay/engine.go:240-257` — applyCompiledRewriteRules
  - `project/backend/internal/relay/engine.go:262-281` — applyCompiledResponseRewriteRules

  Acceptance criteria (agent-executable):
  - `go build ./...` succeeds.
  - `go test ./...` passes (existing tests still pass — no behavior change for body-only rules).

  QA scenarios: happy only (build + existing tests). Evidence `.omo/evidence/task-5-header-rewrite/build.log`.

  Commit: Y | `feat(relay): wire header KV through engine.go call sites`

- [x] 6. **Unit tests in rewrite_test.go covering header routing + scope validation + conditions + engine wiring**
  What to do / Must NOT do:
  - Add new test functions; do NOT modify existing body-only tests.
  - Test functions to add (all in `project/backend/internal/relay/rewrite_test.go`, or new file `rewrite_header_test.go` if file already exceeds 600 lines):
    - `TestRewriteHeaderSetDelete` — set then delete (modes 1-2)
    - `TestRewriteHeaderAppendPrepend` — append / prepend (modes 3-4)
    - `TestRewriteHeaderEnsureTrim` — ensure_prefix, ensure_suffix, trim_prefix, trim_suffix (modes 5-8)
    - `TestRewriteHeaderStringOps` — trim_space, to_lower, to_upper (modes 9-11)
    - `TestRewriteHeaderReplaceRegex` — replace / regex_replace (modes 12-13)
    - `TestRewriteHeaderConditionPath` — eq / neq / matches against header value, including nested AND/OR
    - `TestRewriteHeaderCopyMoveRejected` — copy / move on header scope return error
    - `TestRewriteScopeCompileValidation` — 6 cases (3 scopes × 2 path types) for T1's compile validation
    - `TestRewriteEngineHeaderWiring` — call `applyCompiledRewriteRules` and `applyCompiledResponseRewriteRules` directly with a header rule; assert `req.Headers["X-Foo"]` / `resp.Headers["X-Foo"]` is set
  - Each test compiles a script, calls `applyRewriteChains(body, headers, chains)` (or engine function for the wiring test), asserts both return values.
  - Do NOT modify `TestRewriteHeaderRoutingStub` / `TestRewriteChainsNilGuard` (added in T2) — they stay as-is; the matrix below is additional coverage, not a replacement.
  - Do NOT touch integration tests yet (T9).

  Parallelization: Wave 3 | Blocked by: T5 | Blocks: T7

  References:
  - Existing tests in `project/backend/internal/relay/rewrite_test.go` (read for patterns; mimic the table-driven style if present).

  Acceptance criteria (agent-executable):
  - `go test ./internal/relay/...` passes with new tests included.
  - `go test ./...` passes overall (no regressions).
  - Total new test cases: 13 (mode happy paths) + 4 (conditions incl. nested) + 2 (copy/move rejected) + 6 (scope validation) + 1 (engine wiring) = 26 new test cases.

  QA scenarios: evidence in `.omo/evidence/task-6-header-rewrite/test.log` (full test output).

  Commit: Y | `test(relay): add header routing + scope + condition + engine wiring unit tests`

- [x] 7. **Backend build + go test verification**
  What to do / Must NOT do:
  - Run `cd project/backend && go build ./...`.
  - Run `cd project/backend && go test ./...`.
  - Run `go vet ./...` (if project uses it).
  - Capture full output to `.omo/evidence/task-7-header-rewrite/build.log` and `test.log`.

  Parallelization: Wave 3 | Blocked by: T6 | Blocks: T9

  References: project/backend

  Acceptance criteria (agent-executable):
  - `go build ./...` exits 0.
  - `go test ./...` exits 0 with all tests passing (existing + new).
  - `go vet ./...` (if applicable) exits 0.

  QA scenarios: happy only. Evidence `.omo/evidence/task-7-header-rewrite/`.

  Commit: N (no source change)

- [x] 8. **Documentation: rewrite-ops.md header section**
  What to do / Must NOT do:
  - Locate `project/docs/rewrite-ops.md` (or wherever the rule docs live — search for the file linked from `PolicyPage.tsx`'s `REWRITE_OPS_DOC_URL = 'https://github.com/woohahahaaa/hapiy/blob/main/project/docs/rewrite-ops.md'`).
  - Add a new section `## Header 改写` explaining:
    - Path prefix `header.<Header-Name>` (case-sensitive to match the literal wire format; HTTP normalizes at the protocol layer).
    - 13 supported modes with the same semantics as body modes.
    - `scope` field: `header` / `body` / `all` (default).
    - Examples: set X-Request-ID, append X-Trace, condition on Authorization prefix, etc.
    - Limitations: copy/move cross-scope not supported; Set-Cookie multi-value not supported.
    - **Request-side caveat (verified in `setupUpstreamHeaders` engine.go:385-396)**: headers named `Authorization`, `Content-Length`, `Host`, `Connection` are skipped when writing to the upstream request (`httpReq.Header.Set(k, v)` is guarded by a `continue` for these four). A rewrite rule targeting `header.Authorization` etc. WILL mutate `req.Headers` in the engine, but the value will NOT reach the upstream — the header is set from the API key. Document this so users don't file a bug later.
  - Do NOT remove or rewrite existing body-only sections.

  Parallelization: Wave 3 | Blocked by: T5 | Blocks: T9

  References:
  - `project/docs/rewrite-ops.md` (existing body modes docs to mirror style)
  - `project/web/src/pages/PolicyPage.tsx:47` — link target

  Acceptance criteria (agent-executable):
  - File exists at the path; new section present.
  - Doc link from PolicyPage still resolves (file path unchanged).

  QA scenarios: happy only. Evidence `.omo/evidence/task-8-header-rewrite/`.

  Commit: Y | `docs(relay): document header path prefix and scope field`

- [x] 9. **Live integration test via httptest.Server as upstream stand-in**
  What to do / Must NOT do:
  - **Use Go's `net/http/httptest.Server` as a mock upstream** that records the headers it receives. No "debug log" hack.
  - Write a Go test file `project/backend/internal/relay/integration_header_test.go` (distinct from T6's `rewrite_header_test.go` — T6 covers unit-level, T9 covers engine+upstream round-trip) that:
    1. Starts an `httptest.NewServer(handler)` whose handler captures `r.Header.Get("X-Route")` into a package-level variable (with a `sync.Mutex` or atomic guard if the test could run in parallel).
    2. Builds the engine instance: `eng := &Engine{}` — `applyCompiledRewriteRules` is a method on `*Engine` and touches no DB in the pure-rewrite path (verify by reading engine.go:240-257). No DB, no services needed.
    3. Constructs an `ExecutionPlan` with one `CompiledRewriteChain` containing `{"path":"header.X-Route","mode":"set","value":"premium-tier","scope":"header"}`.
    4. Sets `req.Headers = map[string]string{"X-Other":"untouched"}` and `req.Body = map[string]interface{}{"model":"gpt-4"}`.
    5. Calls `eng.applyCompiledRewriteRules(plan, req)`; assert `req.Headers["X-Route"] == "premium-tier"` and `req.Headers["X-Other"] == "untouched"` and `req.Body` still has `model: "gpt-4"`.
    6. Then — to prove the header reaches the wire — build the actual upstream `*http.Request` via the same path the engine uses (`http.NewRequestWithContext` + copy `req.Headers` with `httpReq.Header.Set(k, v)`, mirroring `setupUpstreamHeaders` minus the auth/blacklist logic, OR call `eng.setupUpstreamHeaders(httpReq, "test-key", req)` directly since it's in the same package) and `server.Client().Do(httpReq)`; assert the recorded `X-Route` on the mock equals `"premium-tier"`.
  - Do NOT call `relayWithFailover` — it needs a full Provider/DB setup and would hit the network with auth. The direct `applyCompiledRewriteRules` + `setupUpstreamHeaders` path is the minimal end-to-end proof and stays hermetic.
  - **Cleanup**: httptest.Server cleans up automatically via `defer server.Close()`. No DB writes.

  Parallelization: Wave 3 | Blocked by: T7, T8 | Blocks: Final wave

  References:
  - Go stdlib `net/http/httptest` — server pattern
  - `project/backend/internal/relay/engine.go:240-257` — applyCompiledRewriteRules (the function being exercised)
  - `project/backend/internal/relay/engine.go:385-396` — setupUpstreamHeaders (same-package helper to copy headers onto the real request; reuses the header-write path)

  Acceptance criteria (agent-executable):
  - Test asserts `req.Headers["X-Route"] == "premium-tier"` after `applyCompiledRewriteRules` runs.
  - Test asserts `req.Headers["X-Other"] == "untouched"` (untouched header preserved).
  - Test asserts `req.Body` JSON unchanged.
  - Test asserts the mock upstream recorded `X-Route: premium-tier` after the real `http.Request` round-trip.
  - `go test ./internal/relay/... -run TestIntegration` passes.

  QA scenarios: happy + failure. Evidence `.omo/evidence/task-9-header-rewrite/integration-test.log`.

  Commit: Y | `test(relay): integration test for header KV via httptest.Server capture`

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit
  - Every Must-have in this plan is implemented and tested. No Must-NOT violated. Use `git diff --stat` to confirm only the expected files were touched (rewrite.go, engine.go, rewrite_test.go, docs/rewrite-ops.md).
- [x] F2. Code quality review
  - `go vet ./...` clean; no dead code (no `TODO` markers left in rewrite.go from T2 stub); no unused imports; no shadowed variables.
- [x] F3. Real manual QA
  - Live integration test from T9 was run; header was actually modified on the upstream request.
- [x] F4. Scope fidelity
  - No `set_header` mode added; no per-rule scope field; no `RelayRequest.Headers` type change; no `PolicyPage.tsx` edit; no Set-Cookie multi-value code.

## Commit strategy
- One commit per source-changing todo: T1, T2, T3, T4, T5, T6, T8, T9 = 8 commits total. T7 is verification only (no commit).
- Branch from current main; merge as a single PR titled `feat(relay): header path prefix support with scope field`.
- Squash if the project prefers atomic commits.

## Success criteria
1. Backend compiles and all tests pass.
2. A rule with `[{"path":"header.X-Foo","mode":"set","value":"bar","scope":"header"}]` modifies the actual HTTP header on the upstream request.
3. Existing rules (no `scope` field, body paths only) continue working without modification.
4. Documentation updated with header section and example.
