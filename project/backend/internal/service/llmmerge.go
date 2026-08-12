package service

// llmmerge.go — Port of mitllm's `_merge_llm_body` family (Python → Go).
// Reference: mitllm/backend.py `_parse_sse_events`, `_merge_fragment`,
// `_merge_tool_calls`, `_merge_chat_completion_chunks`,
// `_merge_responses_api_events`, `_merge_anthropic_events`, `_merge_llm_body`.
//
// Behaviour is intentionally identical to the Python source so the two
// dashboards surface the same merged JSON for the same captured body. The
// output type is map[string]any (or []any / string / etc.) that the JSON
// encoder will serialise back to the client.
//
// Not safe for concurrent mutation of the same map; each MergeLLMBody call
// builds fresh maps, so concurrent calls do not race.

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// MergeLLMBody returns the reconstructed body for a captured HTTP response.
//
//   - non-SSE JSON: parsed as JSON and returned as-is.
//   - SSE: dispatched to the provider-specific merger (OpenAI Chat chunks,
//     OpenAI Responses events, Anthropic messages). Errors include the SSE
//     parse error count or "unsupported format".
//
// `contentType` is the response's Content-Type header. SSE is detected
// either from `text/event-stream` in the content type or by `data:` appearing
// in the first 1 KiB of the body (matches mitllm's heuristic).
func MergeLLMBody(body, contentType string) (any, error) {
	if body == "" {
		return nil, nil
	}
	isSSE := strings.Contains(strings.ToLower(contentType), "text/event-stream") ||
		strings.Contains(body[:min(len(body), 1024)], "data:")
	if !isSSE {
		var parsed any
		if err := json.Unmarshal([]byte(body), &parsed); err != nil {
			return nil, fmt.Errorf("body is not valid JSON: %w", err)
		}
		return parsed, nil
	}

	events, parseErrors := parseSSEEvents(body)
	if parseErrors > 0 {
		return nil, fmt.Errorf("SSE contains %d invalid JSON event(s)", parseErrors)
	}
	if len(events) == 0 {
		return nil, errors.New("SSE does not contain JSON events")
	}

	for _, e := range events {
		if obj, _ := e["object"].(string); obj == "chat.completion.chunk" {
			return mergeChatCompletionChunks(events)
		}
	}
	for _, e := range events {
		if t, _ := e["type"].(string); strings.HasPrefix(t, "response.") {
			return mergeResponsesAPIEvents(events)
		}
	}
	for _, e := range events {
		if t, _ := e["type"].(string); t == "message_start" {
			return mergeAnthropicEvents(events)
		}
	}
	return nil, errors.New("unsupported SSE response format")
}

// parseSSEEvents splits an SSE body on blank-line boundaries and JSON-decodes
// each block's `data:` lines (joined). Returns the parsed events and the
// count of blocks that failed JSON decoding. `[DONE]` and empty blocks are
// skipped silently.
func parseSSEEvents(body string) ([]map[string]any, int) {
	normalised := strings.ReplaceAll(strings.ReplaceAll(body, "\r\n", "\n"), "\r", "\n")
	events := []map[string]any{}
	errCount := 0
	for _, block := range strings.Split(normalised, "\n\n") {
		var dataLines []string
		for _, line := range strings.Split(block, "\n") {
			if strings.HasPrefix(line, "data:") {
				// strip "data:" prefix and a single optional leading space
				rest := line[len("data:"):]
				if strings.HasPrefix(rest, " ") {
					rest = rest[1:]
				}
				dataLines = append(dataLines, rest)
			}
		}
		data := strings.Join(dataLines, "\n")
		if data == "" || data == "[DONE]" {
			continue
		}
		var ev map[string]any
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			errCount++
			continue
		}
		events = append(events, ev)
	}
	return events, errCount
}

// mergeFragment mirrors mitllm's `_merge_fragment`: string values concatenate
// to the existing key; non-string non-nil values are first-write-wins.
func mergeFragment(target map[string]any, key string, value any) {
	if value == nil {
		return
	}
	if s, ok := value.(string); ok {
		existing, _ := target[key].(string)
		target[key] = existing + s
		return
	}
	if _, present := target[key]; !present {
		target[key] = value
	}
}

// mergeToolCalls mirrors mitllm's `_merge_tool_calls`: groups fragments by
// `index`, falls back to positional index when missing, recursively merges
// `function` sub-objects, and other fields go through mergeFragment.
func mergeToolCalls(target map[int]map[string]any, fragments []any) {
	for pos, raw := range fragments {
		fragment, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		idx := pos
		if v, ok := fragment["index"].(float64); ok {
			idx = int(v)
		}
		tool, present := target[idx]
		if !present {
			tool = map[string]any{}
			target[idx] = tool
		}
		for k, v := range fragment {
			if k == "index" {
				continue
			}
			if k == "function" {
				if fnMap, ok := v.(map[string]any); ok {
					fn, present := tool["function"].(map[string]any)
					if !present {
						fn = map[string]any{}
						tool["function"] = fn
					}
					for fk, fv := range fnMap {
						mergeFragment(fn, fk, fv)
					}
				}
				continue
			}
			mergeFragment(tool, k, v)
		}
	}
}

// mergeChatCompletionChunks builds the final chat.completion from a stream of
// chat.completion.chunk events. Mirrors mitllm's logic: seed with first
// chunk's metadata, demote `object` from `chat.completion.chunk` to
// `chat.completion`, accumulate choices[].message.{content,tool_calls,...}
// from each `delta`, take the last non-nil `usage`, and bucket unknown
// top-level keys as `_stream_extensions`.
func mergeChatCompletionChunks(events []map[string]any) (map[string]any, error) {
	if len(events) == 0 {
		return nil, errors.New("no chat completion chunks to merge")
	}
	var first map[string]any
	for _, e := range events {
		if obj, _ := e["object"].(string); obj == "chat.completion.chunk" {
			first = e
			break
		}
	}
	if first == nil {
		first = events[0]
	}

	merged := map[string]any{}
	for k, v := range first {
		if k == "choices" || k == "usage" {
			continue
		}
		merged[k] = v
	}
	if obj, _ := merged["object"].(string); obj == "chat.completion.chunk" {
		merged["object"] = "chat.completion"
	}

	choices := map[int]map[string]any{}
	var usage any
	var streamExtensions []any

	for _, event := range events {
		if u, ok := event["usage"]; ok && u != nil {
			usage = u
		}

		rawChoices, _ := event["choices"].([]any)
		extension := len(rawChoices) == 0
		if !extension {
			extension = true
			for k := range event {
				if k == "id" || k == "object" || k == "created" || k == "model" || k == "choices" || k == "usage" {
					extension = false
					break
				}
			}
		}
		if extension {
			streamExtensions = append(streamExtensions, event)
			continue
		}

		for k, v := range event {
			if k == "id" || k == "object" || k == "created" || k == "model" || k == "choices" || k == "usage" {
				continue
			}
			if _, present := merged[k]; !present {
				merged[k] = v
			}
		}

		for _, rawChoice := range rawChoices {
			rc, ok := rawChoice.(map[string]any)
			if !ok {
				continue
			}
			idx := 0
			if v, ok := rc["index"].(float64); ok {
				idx = int(v)
			}
			choice, present := choices[idx]
			if !present {
				choice = map[string]any{"index": idx, "message": map[string]any{}}
				choices[idx] = choice
			}
			message := choice["message"].(map[string]any)
			delta, _ := rc["delta"].(map[string]any)
			for k, v := range delta {
				switch k {
				case "tool_calls":
					if list, ok := v.([]any); ok {
						bucket, _ := message["_tool_calls_by_index"].(map[int]map[string]any)
						if bucket == nil {
							bucket = map[int]map[string]any{}
							message["_tool_calls_by_index"] = bucket
						}
						mergeToolCalls(bucket, list)
					}
				case "function_call":
					if fn, ok := v.(map[string]any); ok {
						existing, _ := message["function_call"].(map[string]any)
						if existing == nil {
							existing = map[string]any{}
							message["function_call"] = existing
						}
						for fk, fv := range fn {
							mergeFragment(existing, fk, fv)
						}
					}
				case "content", "reasoning_content", "thinking", "refusal":
					mergeFragment(message, k, v)
				default:
					if v != nil {
						if _, present := message[k]; !present {
							message[k] = v
						}
					}
				}
			}
			for k, v := range rc {
				if k == "index" || k == "delta" {
					continue
				}
				if v != nil {
					choice[k] = v
				} else if _, present := choice[k]; !present {
					choice[k] = v
				}
			}
		}
	}

	mergedChoices := make([]any, 0, len(choices))
	for _, idx := range sortedKeys(choices) {
		choice := choices[idx]
		message := choice["message"].(map[string]any)
		if bucket, ok := message["_tool_calls_by_index"].(map[int]map[string]any); ok {
			delete(message, "_tool_calls_by_index")
			tcs := make([]any, 0, len(bucket))
			for _, k := range sortedKeys(bucket) {
				tcs = append(tcs, bucket[k])
			}
			message["tool_calls"] = tcs
		}
		mergedChoices = append(mergedChoices, choice)
	}
	merged["choices"] = mergedChoices
	if usage != nil {
		merged["usage"] = usage
	}
	if len(streamExtensions) > 0 {
		merged["_stream_extensions"] = streamExtensions
	}
	return merged, nil
}

// mergeResponsesAPIEvents returns the final `response` object from the last
// `response.completed` event in the stream. Mirrors mitllm.
func mergeResponsesAPIEvents(events []map[string]any) (map[string]any, error) {
	for i := len(events) - 1; i >= 0; i-- {
		e := events[i]
		if t, _ := e["type"].(string); t == "response.completed" {
			if resp, ok := e["response"].(map[string]any); ok {
				return resp, nil
			}
		}
	}
	return nil, errors.New("responses API stream does not contain response.completed")
}

// mergeAnthropicEvents builds the final Anthropic message from a stream
// starting with `message_start`. Mirrors mitllm: seed merged with start's
// `message`, accumulate `content_block_delta` text/thinking/input_json by
// index, fold `message_delta` into merged, and finalise `usage` from any
// event that carries one.
func mergeAnthropicEvents(events []map[string]any) (map[string]any, error) {
	var start map[string]any
	for _, e := range events {
		if t, _ := e["type"].(string); t == "message_start" {
			if msg, ok := e["message"].(map[string]any); ok {
				start = msg
				break
			}
		}
	}
	if start == nil {
		return nil, errors.New("anthropic stream does not contain message_start")
	}

	merged := map[string]any{}
	for k, v := range start {
		merged[k] = v
	}
	blocks := map[int]map[string]any{}
	usage, _ := merged["usage"].(map[string]any)

	for _, event := range events {
		eventType, _ := event["type"].(string)
		idx := 0
		if v, ok := event["index"].(float64); ok {
			idx = int(v)
		}
		switch eventType {
		case "content_block_start":
			if cb, ok := event["content_block"].(map[string]any); ok {
				blocks[idx] = copyMap(cb)
			}
		case "content_block_delta":
			block, present := blocks[idx]
			if !present {
				block = map[string]any{}
				blocks[idx] = block
			}
			if delta, ok := event["delta"].(map[string]any); ok {
				switch delta["type"] {
				case "text_delta":
					mergeFragment(block, "text", delta["text"])
				case "thinking_delta":
					mergeFragment(block, "thinking", delta["thinking"])
				case "input_json_delta":
					mergeFragment(block, "_input_json", delta["partial_json"])
				}
			}
		case "message_delta":
			if delta, ok := event["delta"].(map[string]any); ok {
				for k, v := range delta {
					merged[k] = v
				}
			}
			if u, ok := event["usage"].(map[string]any); ok {
				if usage == nil {
					usage = map[string]any{}
				}
				for k, v := range u {
					usage[k] = v
				}
			}
		}
	}

	for _, block := range blocks {
		if partial, ok := block["_input_json"]; ok {
			delete(block, "_input_json")
			if s, ok := partial.(string); ok {
				var parsed any
				if err := json.Unmarshal([]byte(s), &parsed); err == nil {
					block["input"] = parsed
				} else {
					block["input"] = s
				}
			} else {
				block["input"] = partial
			}
		}
	}

	content := make([]any, 0, len(blocks))
	for _, idx := range sortedKeys(blocks) {
		content = append(content, blocks[idx])
	}
	merged["content"] = content
	if usage != nil {
		merged["usage"] = usage
	}
	return merged, nil
}

func copyMap(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

// sortedKeys returns the keys of a map[int]X in ascending order. Used by the
// chat-completion and anthropic mergers to keep the output deterministic.
func sortedKeys[V any](m map[int]V) []int {
	keys := make([]int, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	// simple insertion sort — keys are usually <10
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && keys[j-1] > keys[j]; j-- {
			keys[j-1], keys[j] = keys[j], keys[j-1]
		}
	}
	return keys
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}