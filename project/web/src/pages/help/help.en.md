# hapiy Help

## What hapiy is

hapiy is a **self-hosted AI gateway and agent onboarding manager**: one API surface for every upstream model, and one click to point your AI coding tools at your own gateway instead of editing each client config by hand.

- **Model gateway**: exposes OpenAI-compatible HTTP endpoints (`/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`, `/v1/images/generations`, `/v1/audio/speech`, `/v1/audio/transcriptions`), so clients only change a BaseURL and a token; internally it forwards requests along the "Topology" to OpenAI-compatible, Anthropic-compatible, self-hosted or third-party upstreams.
- **Management**: providers and key pools, tokens and quota, request/response rewrite, concurrency control, failover and auto recovery, channel affinity.
- **Monitoring & cost**: log capture, activity monitor, usage logs, usage and cost statistics.
- **Agent takeover**: take over config files of opencode, Codex, openclaw, WorkBuddy, DeepSeek Harness and more (locally or over SSH), writing the hapiy address and token into them.

All data lives in a local SQLite database; single-process deployment.

A request's full journey: the client calls hapiy with `Authorization: Bearer hk-...` → token auth → the topology (request entry, switch, provider slots) picks a usable upstream provider and Key → request rewrite → concurrency control → upstream call → response rewrite → usage record written and usage accumulated.

> Note: hapiy is a pass-through gateway; it does not change the OpenAI request/response format. Clients change two things: point the request URL at hapiy (for the OpenAI SDK, `base_url` is `http(s)://<hapiy address>/v1`) and replace the API Key with the `hk-` token created on the Tokens page.

## Quick start

The first time around, these four steps get your first API forwarding workflow running.

### Step 1 Add a provider

Go to "Models → Providers" and click "Add provider":

- **Name**: your own name for it; globally unique.
- **Base URLs**: the upstream endpoints, for example `https://api.openai.com/v1`, one per line.
- **API Keys**: upstream keys, one per line, notes allowed.
- **Models**: the model names the upstream supports (case-sensitive); you can also click "Fetch models from upstream".
- **Endpoints**: leave empty to allow any request path.

After saving, make sure the row shows "enabled". A dialog then asks whether to add it to the topology — choose "Add to topology" to wire it in automatically (a minimal workflow is created when none is usable), after which requests can route to it; choose "Not now" and the provider only keeps its configuration without serving requests.

### Step 2 Create a token

Go to "Models → Tokens", click "Add token", fill in a name (quota may stay empty = unlimited) and save. Then click the copy icon in the list to get the full `hk-` token — clients use it to call hapiy.

### Step 3 Build the topology

Open "Topology":

1. Right-click an empty spot on the canvas and choose "Add full workflow" to generate the whole chain: request entry → providers → failover → request rewrite → response rewrite → concurrency → log capture.
2. In the "Providers" slot click add and bind the provider from step 1 using the "Choose provider" dropdown.
3. Make sure the request entry switch in the top-right corner is on (keep its weight at 1).

Topology changes save automatically; there is no save button.

### Step 4 Verify with a call

Send one request with the token you just created:

```bash
curl http://<hapiy address>/v1/chat/completions \
  -H "Authorization: Bearer hk-your-token" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-model-name","messages":[{"role":"user","content":"hello"}]}'
```

`model` must be in the provider's model list (case-sensitive; an empty model list means any model name is accepted). Once the request succeeds, the topology shows the animated path the request took, "Monitor → Activity" has the live request list, and "Usage Logs" shows this call's latency and token usage.

### When a call fails

| Symptom | Cause |
| --- | --- |
| 401 `invalid token` | Wrong token, a disabled token, or a missing `Authorization: Bearer` header |
| 403 `quota exceeded` | The token's quota is used up |
| 503 `No usable provider found for xxx` | No usable route in the topology: check the model name case, whether the provider is enabled, whether the entry is on, and whether the topology is wired |
| 404 `path not found` | An unsupported API path was called, or the provider's Endpoints list does not allow that path |

## Topology

"Topology" is the heart of the system: a visual flow chart of "where a request goes after it arrives". The status line under the title shows the active request entries and the node count.

### Canvas controls

- **Right-click an empty spot** or click "Add node" in the bottom-right corner to open the add menu: add full workflow, add request entry, add provider slot, add rule slots (request rewrite / response rewrite / concurrency / failover / log capture), add switch, add emergency provider.
- **Connect**: drag from a node's right dot to the next node's left dot. Illegal connections (cycles, duplicate slots, multiple outgoing edges on a node) are rejected with a reason; drag an edge's endpoint to empty space to disconnect.
- **Box select**: click "Box select" in the bottom-right corner, then drag to select several nodes.
- **Delete**: select a node and press Delete or click the delete button in the bottom-left corner; a confirmation appears. Selecting only an edge disconnects it right away, without a dialog.
- **Undo / Redo**: `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`; up to 100 steps, cleared on page reload. Note: undo covers nodes, edges and configuration, but not node positions.
- **Copy / Paste**: `Ctrl/Cmd+C`, `Ctrl/Cmd+V` for the selected subgraph.
- The bottom-right corner also has "Auto layout", "Maximize all nodes" and "Model node colors" (configures the model node glow color; HEX values separated by spaces).

### Node types

| Node | Purpose |
| --- | --- |
| Model center | Generated from the providers' model lists; shows every available model, and clicking a model name copies it. No need to wire it manually |
| Request entry | The workflow's starting point: on/off switch plus weight in the top-right corner; weight 0 equals disabled |
| Providers slot | Binds one or more providers; the top-right button switches the selection strategy: sequential / random / round-robin |
| Request rewrite slot | Binds request rewrite rules; several are allowed, drag to reorder |
| Response rewrite slot | Binds response rewrite rules |
| Concurrency slot | Inline "at most N within X minutes", one per slot |
| Failover slot | Binds failover rules |
| Log capture slot | Captures raw requests/responses; off by default, the top-right switch sets how long it stays on |
| Switch | Decides the yes/no branch from provider/model filters or request header/body conditions |

### How requests flow

- A request starts from an **enabled request entry**, follows the edges through a provider slot (which picks a provider card internally) and then the remaining slots. Every node has at most one outgoing edge; only a switch has two (yes/no).
- When several entries have usable providers, traffic is split by entry weight; entries with weight 0 or a switched-off entry do not take part.
- The "emergency request entry" only kicks in when no ordinary entry can find a usable provider; it switches back automatically once the normal route recovers. Emergency routes are marked with a warning color.
- A slot unreachable from every enabled entry turns gray and stops accepting interaction (except "Log capture", which has its own switch). Gray does not mean data loss.
- A switch is evaluated per request: a provider/model filter hit, or a request header/body condition hit, takes the yes branch; the two branches are mutually exclusive. With nothing configured it takes yes by default.

### Saving and version history

- Every change saves automatically after about 0.4 seconds; a failed save is reported and retried.
- Node positions (the layout) are saved separately from the topology data.
- "Version History" in the top-right corner previews and restores versions; the current version is archived first, so you can always go back. The system keeps a stable version every 5 minutes, up to 20.
- If the same topology was edited on another page, hapiy asks you to refresh instead of merging automatically.

## Models

### Providers

The "Providers" page maintains upstream API providers — where requests ultimately go.

Each row shows the name, Base URLs, Keys, Endpoints, models, status and failover state, and can be enabled/disabled, edited or deleted.

Form fields for creating/editing:

- **Name**: required, globally unique; duplicates are rejected.
- **Base URLs**: one per line; a trailing `/` is removed on save. The **first address** is used by "Fetch models from upstream".
- **API Keys**: one Key per line, notes allowed; the **first Key** may or may not be sent when fetching models.
- **Endpoints**: the list of allowed paths (for example `/chat/completions`); a request path must end with one of them (`/v1/chat/completions` matches `/chat/completions`); empty means no restriction.
- **Models**: one model name per line, each with its own price and Endpoint settings; an empty model list accepts any model name.
- **Model price**: three modes —
  - Set a price: four fields (input / cache write / cache read / output, per 1M token) that must start with `$` or `¥`; the symbol sets the model's billing currency;
  - Sync from models.dev: choose a reference provider, sync the reference price and optionally set a multiplier (fractions such as `1/2` are supported);
  - Not set: billed as 0.
- **Fetch models from upstream**: a dialog whose top field takes the "Model list endpoint" path (appended to the first Base URL) plus a checkbox for sending the first Key; click "Fetch" to pull the upstream models, then "Select all / Deselect all" and choose "Add" (merge and dedupe) or "Clear existing and add" (replace all). The endpoint settings only apply to this fetch and are not saved on the provider (change the global default under "Settings → Advanced Query → Get Model List").

There is no "Test connection" button; verify connectivity with "Fetch models from upstream".

Deleting a provider does not clean up its bindings in the topology — handle those afterwards.

After saving a new provider hapiy asks whether to add it to the topology: confirming adds it as an extra card to the provider slot of the first usable workflow; if no workflow is enabled yet, a minimal "request entry → providers" chain is created. Providers already in the topology are not added twice.

### Tokens

The "Tokens" page issues the tokens clients use to reach hapiy.

- **Name**: required, globally unique.
- **Quota**: empty = unlimited. Each successful request deducts by token usage; once the quota is used up, requests with that token are rejected (`quota exceeded`).
- **Key**: generated by the server after saving, starting with `hk-`. The list shows only the first few characters; the copy button copies the full Key.
- Enable/disable and delete are supported. Deleting invalidates requests using that token immediately, with no recovery.

How clients call:

```text
Authorization: Bearer hk-xxxxxxxx
```

Note: tokens have no expiry, groups or model allow-list; to rotate, just create a new token.

## Request Handling

### Request rewrite

"Request rewrite" rules modify the request before the upstream call. A rule is made of **blocks**, each with a set of conditions plus a set of actions: actions run only when the conditions match, and empty conditions always run.

**Conditions**:

- Scope is `header` or `body`; the path is a header name or a gjson path (such as `model`, `messages.0.content`, `messages.-1.content`);
- Operators: contains, starts with, ends with, equals, not equals, greater than, greater or equal, less than, less or equal, regex match;
- Conditions use JSON syntax: fixed strings need quotes (`"hello"`), `true/false/null/numbers` are literals, and bare unquoted text is dropped;
- You can tick "Invert match", or combine conditions with `AND (all)` / `OR (any)`.

**Actions** (run in order): set value, delete field, append string, prepend string, prepend to first stream chunk, append to last stream chunk, trim prefix, trim suffix, ensure prefix, ensure suffix (added only when missing), trim whitespace, to lower case, to upper case, string replace, regex replace, rename/move, copy. `move`/`copy` are not available in the header scope.

For the "set value" action the quotes mean something different than in conditions: unquoted = a variable reference (the same-named header or same-path body value from the request as it was before the rewrite started); quoted = a fixed string; `true/false/null/number` = a JSON literal.

**Test**: the "Test" button in the top-right corner lets you pick a rule, paste a JSON request body and see the result immediately. The test only covers the body; header actions do not show up in the output.

**Binding**: after creating a rule it only takes effect once selected in a "Request rewrite" slot of the topology; one slot can hold several rules, executed in order.

### Response rewrite

The same usage as request rewrite, but applied to what the upstream returns. Only four actions exist: rename field, add prefix, add suffix, delete field. Non-stream responses are rewritten as a whole (including a corrected `Content-Length`); streaming responses are rewritten event by event — "add prefix" happens on the first matching event and "add suffix" waits until the stream ends.

Note: in streaming mode response rewrite does not evaluate conditions; conditions only apply to non-stream responses.

### Failover and auto recovery

The "Failover" page configures how the channel switches when the primary one fails, and when a bad channel is marked disabled.

Rule fields:

- **Failover dimension**: Base URL / Key / Provider;
- **Auto-disable**: whether hits accumulate and disable the offending channel;
- **Triggers**: TTFB timeout (seconds), speed limit (token/s), upstream error containing keywords;
- New rules trigger on **any non-2xx response** by default.

The speed limit is special: it is evaluated from the overall speed after the response completes, only accumulates hits, and does not resend the request.

Once the "disable threshold" (N hits within X minutes) is reached, the channel is marked disabled and a "failover" event is recorded. A rule also has to be bound in a "Failover" slot of the topology to take effect.

The "Auto Recovery" tab brings disabled channels back, in two modes:

- **Test upstream to recover** (recommended): poll at an interval (minutes), re-test with the request saved at disable time and only recover when the test passes and the original rule condition holds; interval 0 = off;
- **Scheduled recovery**: once the countdown reaches zero the channel is restored without probing.

The "waiting to recover" list shows the disabled objects: "Test upstream" opens a preview and tries a re-test, "Restore" lifts the disable immediately. "Test method" configures how the saved request body is simplified for the re-test (for example replacing message content with "hello" and dropping big fields), and how long records without a body cool down before a recovery attempt.

### Channel affinity

"Channel affinity" makes the same session **reuse the provider + Base URL + Key it used last time** across requests, so multi-channel rotation does not break the context (important for services that rely on upstream caches and session state).

There is one global configuration; the page has a master switch and three fields:

- **Session ID headers**: one per line, case-insensitive; looked up in headers only (never in the body), and the first non-empty one wins.
- **Model fields**: gjson paths, one per line; used to find the model name in the request body; when empty, the request's `model` field is used directly.
- **Cache TTL (seconds)**: counted from the session's last successful request; after it expires the topology is consulted again. Default 1800.

The order is: channel affinity first, then normal topology selection; a hit also requires the channel to still be in the usable set. A failover clears the affinity record too, so requests do not stick to a failed channel. Records live in the database and survive restarts.

A request rewrite (Request Handling) sometimes only adds the session header after dispatch — for instance when the session id is derived from the request body. Such a session is still invisible when dispatch runs, so the first affinity recall misses it. The gateway therefore **runs affinity a second time** once the request rewrite has finished; when that recall hits, the usage record marks the channel affinity with "(after request rewrite)". If the rewrite switches the request to another session (one channel recalled before it, another after), the after-rewrite one wins.

The second recall only reuses the same workflow (the provider does not change; only the Base URL and Key used last time are reused): the rewrite has already run for the current provider, and switching providers mid-request would discard the rewrite as well as the concurrency, logging and failover wiring built for it. To stick a session back to another provider, the client itself must send the session header so the first affinity recall at dispatch can see it.

### Concurrency

Concurrency is not configured on the "Request Handling" page: it lives in a "Concurrency" slot of the topology as an inline "at most N within X minutes".

Semantics: a request occupies a slot on arrival, the countdown starts when it completes, and the slot is released at zero; requests above the limit **queue** (they are not rejected immediately). Several routes sharing one slot node share the same window. When several concurrency slots are on a path, all of them must pass.

## Monitor

### Activity

Live view of in-flight requests and running statistics.

- The cards on top show total requests, successes, failures, success rate, total tokens, total tokens (cache hits deduped), cache hit rate, throughput, average latency and cost, with a date filter; "Clear usage" only clears statistics, not request records.
- The "Active requests" table below refreshes every 2 seconds and shows each request's current stage (queued, connecting upstream, waiting for response, receiving…), TTFB and channel affinity; unfinished requests can be killed.
- Clicking a finished row opens that request's details; "Show active requests within N" adjusts how long finished requests stay in the list.

### Usage Logs

Per-request details — the main place to troubleshoot and see usage.

- Columns: time, source, token, provider, model, channel affinity, Tokens (input / cache write / cache read / output and hit rate), streaming, cost, latency (total and TTFB), speed, status.
- Filters: date, type (request / failover / auto recovery / manual recovery / system), source, token, provider, model, status.
- Click any row for details: upstream URL, upstream Key (masked by default, hover to reveal), per-stage latency (queued / request rewrite / connect / TTFB / response rewrite / stream rewrite), failure reason and more.
- Logs are written in batches, so a new request may take a few seconds to appear; the page does not auto-refresh.
- "Clear" is irreversible, and clearing "the current page" deletes every record matching the current filters (not just the visible page); in this version the type filter does not take part in clearing.

### Log Capture

Review captured **raw** requests/responses, including the before/after difference of rewrites.

- The capture switch is not here: open it in a "Log capture" slot of the topology and set how long it stays on (it turns itself off at the end). The slot also lets you record requests, record responses, and set a log prefix (used as the folder filter).
- The list shows requests in pairs with time, folder, token, provider, model, source, type (request / response / request+response, optionally marked "modified" or "error"), file name / request ID and size.
- Click a row to preview request headers/body and response headers/body separately; content changed by rules is shown in a diff view; streaming responses can be viewed as merged JSON or event by event, and every node can be copied.
- Clearing is irreversible as well; clearing by filter only keeps the folder, source and date conditions.

> Tip: capture is the best way to find out "what the upstream actually returned", but switch it off afterwards so it does not keep writing to disk.

## Agent Takeover

"Agent Takeover" brings the config files of external AI tools (built in: opencode-v1/v2, WorkBuddy, ChatGPT(Codex), openclaw, DeepSeek Harness (desktop/web)) under hapiy's management: it detects the path, edits the content and writes the model access information in, so those tools talk to the hapiy gateway.

### Rules

Each software type has one "takeover rule" describing its default config file paths (Windows/Mac), the provider/model gjson paths inside the config, how model info fields are written, shared recommendation values and so on. Rules for common tools ship with the system and usually need no manual work; you can also "Add takeover rule" to define your own.

Rules can be edited as a table or as JSON: the JSON mode keeps comments, which makes it easy to hand the whole rule to another Agent. After editing a built-in rule, "Use default template" restores the defaults.

### Config files

The "Takeover Config Files" page manages the config file records:

1. Click "Take over a new config file", fill in a record name, pick the software type and the connection method:
   - **Local**: pick the OS (Windows/Mac/other), fill in the path — "Sync preset Agent info" fills in the default path — and the file is checked for existence as you type;
   - **SSH**: host, account, password or private key (a jump host is supported) and the remote path; "Test SSH read/write" verifies connect, read and write.
2. After saving, "Edit config file" opens the file content right in the browser — JSON-family files are validated and re-indented on save, YAML/TOML and friends are saved verbatim; all keep version history. "Manage models" (the software type needs provider/model paths; both JSON and YAML work) adjusts model fields in bulk from the official recommendations, diffs them and applies.
3. To make that Agent use hapiy, open "Manage models" and "Add managed provider": choose the rule, pick the token created on the Tokens page, and hapiy generates the access config containing the hapiy address and token; "Sync to config file" writes it back.

### Enable switch

The "Agent Takeover" entry is hidden from the sidebar by default; turn it on under "Settings → Agent Takeover" (the `/settings/other` page). **Reload the page** afterwards and the entry appears. The switch only controls the menu entry, not the feature.

## Settings

### BaseURL

Configures the system's public address, mainly for Agent Takeover's managed config:

- **Domain**: defaults to the current web domain, port included;
- **Suffix**: `proxy` by default;
- The final BaseURL is domain + suffix, copyable in one click;
- **Source marks**: name your clients to get addresses carrying a `__source` segment; calls made through such an address show that name in the "source" column of Usage Logs.

> Tip: if hapiy sits behind a reverse proxy or tunnel, set the domain to an externally reachable address first — managed Agent config follows it by default.

### Advanced Query

"Advanced Query" merges the three query settings into one page with tabs:

**Get Model List**

- **Default model list endpoint path**: the default endpoint for a provider's "Fetch models from upstream", `/v1/models` by default;
- **hapiy model list endpoint path**: the model list path hapiy exposes; clients can call it with a token and `Authorization: Bearer hk-...` to get the enabled model names.

Both paths must start with `/`.

**Get Token Usage**

Configures the gjson paths used to read token usage from upstream responses. Each of the four counters — input, cache write, cache read, output — takes several paths, tried in order, stopping at the first hit:

- Input: `usage.prompt_tokens`, `usage.input_tokens`, and so on;
- Cache write: `usage.prompt_cache_miss_tokens`, and so on;
- Cache read: `usage.prompt_cache_hit_tokens`, `usage.prompt_tokens_details.cached_tokens`, and so on;
- Output: `usage.completion_tokens`, `usage.output_tokens`, and so on.

Changes apply immediately after saving; "Restore defaults" only resets the form — you still have to click "Save".

> Tip: if Usage Logs always shows 0 tokens, check whether these paths match your upstream response shape.

**Currency & Rates**

- **Global cost currency**: CNY / USD;
- **Rate**: how many CNY one USD is worth;
- The gear button configures an online rate endpoint (URL, field path, daily auto-refresh) with "Test endpoint" and "Save and refresh".

Currency and rate only affect records created afterwards; existing records keep the currency and amount of their time.

### Data Backup

- **Backup contents**: tick the modules to back up; topology, providers, tokens, request handling rules, Agent Takeover and settings are on by default, usage logs and log captures are off;
- **Auto backup frequency**: never / daily / weekly;
- **Relative path**: where backup files are stored, relative to the machine running the backend; the page shows the resolved absolute path live;
- "Manual backup now" runs immediately with the current ticks (without saving them back);
- The history list below restores any backup; "Restore" overwrites the current data of those modules, taking a safety backup first.

### Other

- The "Debug" menu is only visible in development builds.
- The "Agent Takeover" switch is described above.

## Profile

Manages the login account:

- **Username**: takes effect immediately; it cannot be empty, cannot be unchanged, and cannot collide with an existing user;
- **Password**: requires the current password; the new one needs at least 8 characters, entered twice;
- **Sign out**: ends the session and returns to the login page.

## FAQ

**The topology doesn't take effect after a change?** Check, in order: the provider is enabled, the entry switch is on with a non-zero weight, the provider card in the slot is enabled, the model name case matches, and the slot is not gray (unreachable from every entry). For rule slots, also confirm the bound rule was not deleted or disabled.

**How do I recover a disabled channel?** Under "Request Handling → Failover → Auto Recovery", the waiting list offers "Test upstream" and "Restore"; you can also click "Restore" per Provider / Base URL / Key on the provider edit page.

**Is Usage Logs delayed?** Yes — logs are written from memory in batches, up to a few seconds late; the active requests under "Activity" are live.

**Are cost and quota the same thing?** No. A token's quota is deducted by token usage; "cost" is money computed from model prices. They are different measures.

**How do I onboard an Agent tool?** Set the public address under "Settings → BaseURL" first, then add a managed provider under "Agent Takeover → Config Files" and sync it back to the config file.

**Why is Log Capture empty?** Capture is off by default: open the switch in the "Log capture" slot of the topology, set how long it stays on, and make sure the entry records requests/responses and the slot sits downstream of the right provider route.
