package relay

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/textproto"
	"sort"
	"strconv"
	"strings"
)

// BodyFormat is the container of an incoming request body.
//
// hapiy rewrites JSON bodies on the parsed map; a multipart body is decoded
// into the same shape — its text fields — so dispatch, rewrite, affinity and
// log capture stay format-agnostic instead of growing a second pipeline.
type BodyFormat string

const (
	BodyFormatJSON      BodyFormat = "json"
	BodyFormatMultipart BodyFormat = "multipart"
)

// FileMarker marks a view value as a file slice instead of a text field. Its
// value is the index into MultipartBody.Files.
//
// Nothing ever rewrites a file slice: the bytes travel from the incoming body
// to the upstream body untouched, only the part headers (filename, content
// type) can be changed from the view.
const FileMarker = "$file"

// FilePart is one file slice of a multipart body. Data aliases the caller's
// decoded bytes; the encoder copies it verbatim.
type FilePart struct {
	// Index is the slice's position in the request, matching the $file
	// marker the view carries.
	Index       int
	FieldName   string
	Filename    string
	ContentType string
	Data        []byte
}

// partRef records one original slice's position so the encoder can walk the
// body in its original order after a rewrite.
type partRef struct {
	Name string
	// Pos is the slice's index inside that name's value list, so a name
	// carrying several slices (image[] sent twice) keeps its order.
	Pos int
	// File is the index into Files, or -1 for a text slice.
	File int
	// ContentType is the original text slice's content type (empty when the
	// client sent none, which is the common case).
	ContentType string
}

// MultipartBody is the decoded form of a multipart/form-data request.
type MultipartBody struct {
	Boundary string
	// Names is the field order of first appearance.
	Names []string
	// Files holds every file slice, addressed by the $file marker index.
	Files []FilePart

	order []partRef
	seen  map[string]bool
}

// ContentType rebuilds the request content type for this body.
func (m *MultipartBody) ContentType() string {
	return "multipart/form-data; boundary=" + m.Boundary
}

// DetectBodyFormat classifies a request body by its Content-Type header.
// Anything that is not multipart/form-data is treated as JSON, which is what
// the relay pipeline has always assumed.
func DetectBodyFormat(contentType string) BodyFormat {
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err == nil && strings.EqualFold(mediaType, "multipart/form-data") {
		return BodyFormatMultipart
	}
	return BodyFormatJSON
}

// DecodeMultipart parses a multipart/form-data body into the shared view.
//
// Text slices become strings, file slices become a map carrying the $file
// index plus the part's filename, content type and size. A name with more
// than one slice keeps them in a list, in the order they appeared.
func DecodeMultipart(raw []byte, contentType string) (map[string]interface{}, *MultipartBody, error) {
	_, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid multipart content type: %w", err)
	}
	boundary := params["boundary"]
	if boundary == "" {
		return nil, nil, errors.New("multipart boundary missing")
	}

	body := &MultipartBody{
		Boundary: boundary,
		seen:     map[string]bool{},
	}
	view := map[string]interface{}{}
	counts := map[string]int{}

	reader := multipart.NewReader(bytes.NewReader(raw), boundary)
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, nil, fmt.Errorf("read multipart: %w", err)
		}
		name := part.FormName()
		if name == "" {
			part.Close()
			continue
		}
		data, err := io.ReadAll(part)
		part.Close()
		if err != nil {
			return nil, nil, fmt.Errorf("read multipart field %q: %w", name, err)
		}

		pos := counts[name]
		counts[name]++
		if !body.seen[name] {
			body.seen[name] = true
			body.Names = append(body.Names, name)
		}

		if filename := part.FileName(); filename != "" {
			index := len(body.Files)
			body.Files = append(body.Files, FilePart{
				Index:       index,
				FieldName:   name,
				Filename:    filename,
				ContentType: part.Header.Get("Content-Type"),
				Data:        data,
			})
			body.order = append(body.order, partRef{Name: name, Pos: pos, File: index})
			setViewAt(view, name, pos, map[string]interface{}{
				FileMarker:     float64(index),
				"filename":     filename,
				"content_type": part.Header.Get("Content-Type"),
				"size":         float64(len(data)),
			})
			continue
		}

		body.order = append(body.order, partRef{Name: name, Pos: pos, File: -1, ContentType: part.Header.Get("Content-Type")})
		setViewAt(view, name, pos, string(data))
	}

	return view, body, nil
}

// Encode rebuilds the multipart body from the view.
//
// Slices keep their original position and the original boundary is reused, so
// file bytes are copied verbatim: a rewrite that touched only text fields can
// never disturb the image data. Slices the rewrite removed are dropped, and
// fields it added are appended as text slices.
func (m *MultipartBody) Encode(view map[string]interface{}) ([]byte, error) {
	if m == nil {
		return nil, errors.New("no multipart body")
	}
	var buf bytes.Buffer
	writeMultipartSlice := func(name, filename, contentType, value string) {
		buf.WriteString("--")
		buf.WriteString(m.Boundary)
		buf.WriteString("\r\n")
		buf.WriteString(`Content-Disposition: form-data; name="`)
		buf.WriteString(escapeHeaderValue(name))
		buf.WriteString(`"`)
		if filename != "" {
			buf.WriteString(`; filename="`)
			buf.WriteString(escapeHeaderValue(filename))
			buf.WriteString(`"`)
		}
		buf.WriteString("\r\n")
		if contentType != "" {
			buf.WriteString("Content-Type: ")
			buf.WriteString(contentType)
			buf.WriteString("\r\n")
		}
		buf.WriteString("\r\n")
		buf.WriteString(value)
		buf.WriteString("\r\n")
	}

	for _, ref := range m.order {
		values := viewValues(view, ref.Name)
		if ref.Pos >= len(values) {
			continue
		}
		value := values[ref.Pos]
		if ref.File >= 0 {
			part := m.Files[ref.File]
			filename, contentType := part.Filename, part.ContentType
			if object, ok := value.(map[string]interface{}); ok {
				if fileIndex, ok := numericMarker(object[FileMarker]); !ok || fileIndex != ref.File {
					continue
				}
				if s, ok := object["filename"].(string); ok && s != "" {
					filename = s
				}
				if s, ok := object["content_type"].(string); ok && s != "" {
					contentType = s
				}
			}
			writeMultipartSlice(ref.Name, filename, contentType, string(part.Data))
			continue
		}
		text, ok := sliceText(value)
		if !ok {
			continue
		}
		writeMultipartSlice(ref.Name, "", ref.ContentType, text)
	}

	// Fields the rewrite added: append after the original slices, sorted so
	// the same rewrite always produces the same bytes.
	added := make([]string, 0, len(view))
	for name := range view {
		if m.seen[name] {
			continue
		}
		added = append(added, name)
	}
	sort.Strings(added)
	for _, name := range added {
		for _, value := range viewValues(view, name) {
			text, ok := sliceText(value)
			if !ok {
				continue
			}
			writeMultipartSlice(name, "", "", text)
		}
	}

	buf.WriteString("--")
	buf.WriteString(m.Boundary)
	buf.WriteString("--\r\n")
	return buf.Bytes(), nil
}

// ViewFiles returns the file slices the view still references, so capture can
// store the bytes that were actually sent.
func (m *MultipartBody) ViewFiles(view map[string]interface{}) []FilePart {
	if m == nil {
		return nil
	}
	kept := make([]FilePart, 0, len(m.Files))
	for index, part := range m.Files {
		found := false
		for _, value := range viewValues(view, part.FieldName) {
			object, ok := value.(map[string]interface{})
			if !ok {
				continue
			}
			if fileIndex, ok := numericMarker(object[FileMarker]); ok && fileIndex == index {
				found = true
				break
			}
		}
		if found {
			kept = append(kept, part)
		}
	}
	return kept
}

// viewValues flattens a view entry into its slice list. A scalar and a list
// are the same thing to the encoder; a missing field has no slices at all.
func viewValues(view map[string]interface{}, name string) []interface{} {
	value, ok := view[name]
	if !ok || value == nil {
		return nil
	}
	if list, ok := value.([]interface{}); ok {
		return list
	}
	return []interface{}{value}
}

// setViewAt stores the slice at pos, turning the entry into a list on the
// second slice of the same name.
func setViewAt(view map[string]interface{}, name string, pos int, value interface{}) {
	if pos == 0 {
		view[name] = value
		return
	}
	existing, ok := view[name].([]interface{})
	if !ok {
		existing = []interface{}{view[name]}
	}
	for len(existing) <= pos {
		existing = append(existing, nil)
	}
	existing[pos] = value
	view[name] = existing
}

// numericMarker reads the $file index back from a decoded view value.
func numericMarker(value interface{}) (int, bool) {
	switch v := value.(type) {
	case float64:
		return int(v), true
	case int:
		return v, true
	case json.Number:
		parsed, err := v.Int64()
		return int(parsed), err == nil
	}
	return 0, false
}

// sliceText renders a text slice's value. Numbers and booleans keep their
// written form, objects fall back to compact JSON.
func sliceText(value interface{}) (string, bool) {
	switch v := value.(type) {
	case nil:
		return "", false
	case string:
		return v, true
	case bool:
		return strconv.FormatBool(v), true
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64), true
	case int:
		return strconv.Itoa(v), true
	case json.Number:
		return v.String(), true
	case map[string]interface{}:
		if _, isFile := v[FileMarker]; isFile {
			return "", false
		}
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", false
	}
	return string(encoded), true
}

// escapeHeaderValue quotes a name/filename for a Content-Disposition header.
func escapeHeaderValue(value string) string {
	escaped := strings.NewReplacer(`"`, `\"`, `\`, `\\`, "\r", "", "\n", "").Replace(value)
	return textproto.TrimString(escaped)
}

// ViewString reads a scalar field from the decoded request view. A field the
// client sent more than once answers with its first slice.
func ViewString(view map[string]interface{}, name string) string {
	switch value := view[name].(type) {
	case string:
		return value
	case []interface{}:
		if len(value) > 0 {
			if text, ok := value[0].(string); ok {
				return text
			}
		}
	}
	return ""
}

// EncodeBody produces the body hapiy sends upstream.
//
// A request nobody rewrote is forwarded byte for byte with its original
// content type — JSON included, which also stops the relay from silently
// re-serializing (and re-ordering, re-escaping) bodies it never touched. Only
// a rewritten request is re-encoded, from its view.
func (r *RelayRequest) EncodeBody() ([]byte, error) {
	if r.RawBody != nil && !r.BodyDirty {
		return r.RawBody, nil
	}
	if r.Multipart != nil {
		return r.Multipart.Encode(r.Body)
	}
	if r.Body != nil {
		return json.Marshal(r.Body)
	}
	if r.RawBody != nil {
		return r.RawBody, nil
	}
	return json.Marshal(r)
}

// UpstreamContentType is the content type that goes with EncodeBody's output.
func (r *RelayRequest) UpstreamContentType() string {
	if r.Multipart != nil {
		return r.Multipart.ContentType()
	}
	if r.ContentType != "" && !r.BodyDirty {
		return r.ContentType
	}
	return "application/json"
}

// AffinityBody is the body channel affinity reads its session/model fields
// from. A multipart request exposes its form fields as JSON so the configured
// paths (model, session ids) resolve the same way they do for JSON requests.
func (r *RelayRequest) AffinityBody() []byte {
	if r.Multipart == nil {
		return r.RawBody
	}
	if r.Body == nil {
		return nil
	}
	encoded, err := json.Marshal(r.Body)
	if err != nil {
		return nil
	}
	return encoded
}

// FileParts returns the file slices this request actually sends, for capture.
func (r *RelayRequest) FileParts() []FilePart {
	if r.Multipart == nil {
		return nil
	}
	return r.Multipart.ViewFiles(r.Body)
}
