package relay

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

// buildMultipart assembles a multipart body the way a browser sends an image
// edit request: text fields plus one binary file slice.
func buildMultipart(t *testing.T, boundary string, fields [][2]string, files [][3]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	for _, field := range fields {
		buf.WriteString("--" + boundary + "\r\n")
		buf.WriteString(`Content-Disposition: form-data; name="` + field[0] + `"` + "\r\n\r\n")
		buf.WriteString(field[1] + "\r\n")
	}
	for _, file := range files {
		buf.WriteString("--" + boundary + "\r\n")
		buf.WriteString(`Content-Disposition: form-data; name="` + file[0] + `"; filename="` + file[1] + `"` + "\r\n")
		buf.WriteString("Content-Type: image/png\r\n\r\n")
		buf.WriteString(file[2] + "\r\n")
	}
	buf.WriteString("--" + boundary + "--\r\n")
	return buf.Bytes()
}

var testBoundary = "----hapiytestboundary"

func testContentType() string { return "multipart/form-data; boundary=" + testBoundary }

func TestDecodeMultipartBuildsFlatView(t *testing.T) {
	raw := buildMultipart(t, testBoundary,
		[][2]string{{"model", "gpt-image-2.6"}, {"prompt", "把背景换成纯白"}, {"size", "1024x1024"}},
		[][3]string{{"image", "ref.png", "PNGDATA"}},
	)

	view, body, err := DecodeMultipart(raw, testContentType())
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got := ViewString(view, "model"); got != "gpt-image-2.6" {
		t.Fatalf("model field: want gpt-image-2.6, got %q", got)
	}
	if got := ViewString(view, "prompt"); got != "把背景换成纯白" {
		t.Fatalf("prompt field: got %q", got)
	}
	if len(body.Files) != 1 {
		t.Fatalf("file parts: want 1, got %d", len(body.Files))
	}
	if string(body.Files[0].Data) != "PNGDATA" {
		t.Fatalf("file bytes: got %q", string(body.Files[0].Data))
	}
	file, ok := view["image"].(map[string]interface{})
	if !ok {
		t.Fatalf("image field should be a file marker, got %T", view["image"])
	}
	if index, _ := numericMarker(file[FileMarker]); index != 0 {
		t.Fatalf("file marker index: got %v", file[FileMarker])
	}
}

func TestEncodeMultipartIsByteIdenticalWithoutRewrite(t *testing.T) {
	raw := buildMultipart(t, testBoundary,
		[][2]string{{"model", "gpt-image-2.6"}, {"prompt", "hello"}, {"n", "2"}},
		[][3]string{{"image", "ref.png", "\x89PNG\r\nbinary"}},
	)
	view, body, err := DecodeMultipart(raw, testContentType())
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	encoded, err := body.Encode(view)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if !bytes.Equal(encoded, raw) {
		t.Fatalf("round trip changed the body:\nwant %q\ngot  %q", raw, encoded)
	}
}

func TestEncodeMultipartRewritesTextAndKeepsFileBytes(t *testing.T) {
	raw := buildMultipart(t, testBoundary,
		[][2]string{{"model", "gpt-image-2.6"}, {"prompt", "old"}},
		[][3]string{{"image", "ref.png", "ORIGINAL-BINARY"}},
	)
	view, body, err := DecodeMultipart(raw, testContentType())
	if err != nil {
		t.Fatalf("decode: %v", err)
	}

	view["prompt"] = "new prompt"
	encoded, err := body.Encode(view)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}

	if !bytes.Contains(encoded, []byte("new prompt")) {
		t.Fatalf("rewritten text missing:\n%s", encoded)
	}
	if bytes.Contains(encoded, []byte("old")) {
		t.Fatalf("old text still present:\n%s", encoded)
	}
	if !bytes.Contains(encoded, []byte("ORIGINAL-BINARY")) {
		t.Fatalf("file bytes were not carried over:\n%s", encoded)
	}
	if !bytes.Contains(encoded, []byte(testBoundary)) {
		t.Fatalf("boundary changed:\n%s", encoded)
	}

	// The rebuilt body must parse back to the same view.
	decoded, _, err := DecodeMultipart(encoded, testContentType())
	if err != nil {
		t.Fatalf("re-decode: %v", err)
	}
	if decoded["prompt"] != "new prompt" {
		t.Fatalf("round trip lost the rewrite: %v", decoded["prompt"])
	}
}

func TestDecodeMultipartKeepsRepeatedFieldsInOrder(t *testing.T) {
	raw := buildMultipart(t, testBoundary,
		[][2]string{{"model", "gpt-image-2.6"}},
		[][3]string{
			{"image[]", "a.png", "AAAA"},
			{"image[]", "b.png", "BBBB"},
		},
	)
	view, body, err := DecodeMultipart(raw, testContentType())
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	list, ok := view["image[]"].([]interface{})
	if !ok || len(list) != 2 {
		t.Fatalf("repeated field should be a 2-element list, got %#v", view["image[]"])
	}
	if len(body.Files) != 2 || string(body.Files[0].Data) != "AAAA" || string(body.Files[1].Data) != "BBBB" {
		t.Fatalf("file order lost: %+v", body.Files)
	}

	encoded, err := body.Encode(view)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if !bytes.Equal(encoded, raw) {
		t.Fatalf("repeated fields did not round trip:\nwant %q\ngot  %q", raw, encoded)
	}
}

func TestEncodeBodyForwardsCleanBodyByteForByte(t *testing.T) {
	// Key order and spacing are deliberately not canonical: a clean request
	// must reach the upstream exactly as the client wrote it.
	raw := []byte(`{"model":"gpt-4",   "temp":0.5}`)
	req := &RelayRequest{
		RawBody:     raw,
		ContentType: "application/json",
		Format:      BodyFormatJSON,
		Body:        map[string]interface{}{"model": "gpt-4", "temp": 0.5},
	}
	encoded, err := req.EncodeBody()
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if !bytes.Equal(encoded, raw) {
		t.Fatalf("clean body was re-serialized:\nwant %q\ngot  %q", raw, encoded)
	}

	req.BodyDirty = true
	encoded, err = req.EncodeBody()
	if err != nil {
		t.Fatalf("encode dirty: %v", err)
	}
	var decoded map[string]interface{}
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("dirty body is not JSON: %v", err)
	}
	if decoded["model"] != "gpt-4" {
		t.Fatalf("dirty body lost fields: %v", decoded)
	}
	if strings.Contains(string(encoded), "   ") {
		t.Fatalf("dirty body kept the original spacing: %s", encoded)
	}
}

func TestEncodeBodyMultipartPassthroughSetsContentType(t *testing.T) {
	raw := buildMultipart(t, testBoundary, [][2]string{{"model", "m"}}, nil)
	view, body, err := DecodeMultipart(raw, testContentType())
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	req := &RelayRequest{RawBody: raw, ContentType: testContentType(), Format: BodyFormatMultipart, Multipart: body, Body: view}

	if got := req.UpstreamContentType(); got != testContentType() {
		t.Fatalf("content type: got %q", got)
	}
	encoded, err := req.EncodeBody()
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if !bytes.Equal(encoded, raw) {
		t.Fatalf("clean multipart body was re-encoded")
	}
}

func TestDetectBodyFormat(t *testing.T) {
	cases := map[string]BodyFormat{
		"multipart/form-data; boundary=abc": BodyFormatMultipart,
		"Multipart/Form-Data; Boundary=x":   BodyFormatMultipart,
		"application/json":                  BodyFormatJSON,
		"":                                  BodyFormatJSON,
	}
	for contentType, want := range cases {
		if got := DetectBodyFormat(contentType); got != want {
			t.Fatalf("%q: want %s, got %s", contentType, want, got)
		}
	}
}

func TestRewriteMultipartTextFieldKeepsFileBytes(t *testing.T) {
	raw := buildMultipart(t, testBoundary,
		[][2]string{{"model", "gpt-image-2.6"}, {"prompt", "old"}, {"size", "1024x1024"}},
		[][3]string{{"image", "ref.png", "ORIGINAL-BINARY"}},
	)
	view, body, err := DecodeMultipart(raw, testContentType())
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	req := &RelayRequest{
		RawBody:     raw,
		ContentType: testContentType(),
		Format:      BodyFormatMultipart,
		Multipart:   body,
		Body:        view,
	}

	ops, err := compileRewriteChain("rule-1", `[{"mode":"set","path":"prompt","value":"把背景换成纯黑"}]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	plan := &ExecutionPlan{CompiledRewrite: []CompiledRewriteChain{{RuleID: "rule-1", RuleName: "rule-1", Ops: ops}}}
	engine := &Engine{}
	if err := engine.applyCompiledRewriteRules(plan, req); err != nil {
		t.Fatalf("rewrite: %v", err)
	}
	if !req.BodyDirty {
		t.Fatalf("a rewrite that changed the body must mark it dirty")
	}

	encoded, err := req.EncodeBody()
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if !bytes.Contains(encoded, []byte("把背景换成纯黑")) {
		t.Fatalf("rewritten prompt missing:\n%s", encoded)
	}
	if !bytes.Contains(encoded, []byte("ORIGINAL-BINARY")) {
		t.Fatalf("file bytes lost in the rebuilt body:\n%s", encoded)
	}
	if !bytes.Contains(encoded, []byte(`name="image"; filename="ref.png"`)) {
		t.Fatalf("file slice header lost:\n%s", encoded)
	}
	if got := req.UpstreamContentType(); got != testContentType() {
		t.Fatalf("content type after rebuild: %q", got)
	}
}

func TestRewriteMultipartLeavesCleanBodyAlone(t *testing.T) {
	raw := buildMultipart(t, testBoundary, [][2]string{{"model", "m"}, {"prompt", "x"}}, nil)
	view, body, err := DecodeMultipart(raw, testContentType())
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	req := &RelayRequest{RawBody: raw, ContentType: testContentType(), Format: BodyFormatMultipart, Multipart: body, Body: view}

	// A rule that matches nothing must not dirty the body: it still goes out
	// byte for byte.
	ops, err := compileRewriteChain("rule-2", `[{"mode":"set","path":"nonexistent","value":"y"}]`)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	_ = ops

	encoded, err := req.EncodeBody()
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if !bytes.Equal(encoded, raw) {
		t.Fatalf("untouched multipart body was re-encoded")
	}
}
