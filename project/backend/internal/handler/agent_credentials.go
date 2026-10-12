package handler

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/hapiy/hapiy/internal/model"
	"github.com/hapiy/hapiy/internal/service"
	"gopkg.in/yaml.v3"
)

// 凭据库写入（dsh 的 $DSH_HOME/.credentials.yaml 等）
//
// 有些 agent 的配置里只放「凭据引用」而不是明文密钥：dsh 的 pi-ai provider
// 写 `apiKeyEnv: HAPIY_API_KEY`，真正的令牌在凭据库里，请求时按引用解析。
// 规则模板用 credentials 块声明凭据库（路径 / 引用字段 / 文档格式）后，
// 托管同步会在写配置文件之前，把弹窗里选的令牌写进目标机的凭据库 ——
// 否则生成的块引用一个没人存过的凭据，agent 请求时报 MISSING_CREDENTIAL。

// credentialRefRe 是 dsh CredentialRef 的文法（POSIX shell 标识符）。
var credentialRefRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// managedCredentialSpec returns the credential-store declaration of the rule's
// default template, nil when the agent stores its key inline (no template, no
// credentials block, or no reference field declared).
func managedCredentialSpec(ruleName string) *model.AgentCredentialSpec {
	tmpl, ok := model.TemplateForRuleName(ruleName)
	if !ok || tmpl.Credentials == nil {
		return nil
	}
	if strings.TrimSpace(tmpl.Credentials.RefField) == "" {
		return nil
	}
	return tmpl.Credentials
}

// syncManagedCredentials stores the 托管 dialog's chosen 令牌 under every
// credential reference the generated blocks carry, in the credential document
// the rule template declares. No-op when the template declares no store, the
// document format is unknown, the token is empty, or no block references a
// credential. A write failure aborts the sync before the config file changes,
// so a block is never written against a credential that could not be stored.
func syncManagedCredentials(row *model.AgentConfigFile, key []byte, spec *model.AgentCredentialSpec, token string, refs []string) error {
	if row == nil || spec == nil {
		return nil
	}
	if strings.ToLower(strings.TrimSpace(spec.Format)) != "dsh-refs-v1" {
		return nil
	}
	token = strings.TrimSpace(token)
	path := resolveConfigDirPath(row.Path, spec.PathForOS(row.TargetOS))
	refs = uniqueSorted(refs)
	if token == "" || path == "" || len(refs) == 0 {
		return nil
	}
	existing, err := readCredentialDoc(row, key, path)
	if err != nil {
		return fmt.Errorf("凭据写入失败（配置文件未改动）: %w", err)
	}
	updated := existing
	for _, ref := range refs {
		updated, err = upsertCredentialRef(updated, ref, token)
		if err != nil {
			return fmt.Errorf("凭据写入失败（配置文件未改动）: %w", err)
		}
	}
	if updated == existing {
		return nil
	}
	if err := writeCredentialDoc(row, key, path, updated); err != nil {
		return fmt.Errorf("凭据写入失败（配置文件未改动）: %w", err)
	}
	return nil
}

// resolveConfigDirPath substitutes `{config_dir}` with the directory of the
// take-over config file. The template keeps `~` / `%VAR%` placeholders for
// the target machine (the local filesystem expands them on write, a remote
// shell / cmd resolves them remotely); `..` segments resolve on both sides.
func resolveConfigDirPath(configPath, templatePath string) string {
	templatePath = strings.TrimSpace(templatePath)
	if templatePath == "" {
		return ""
	}
	return strings.ReplaceAll(templatePath, "{config_dir}", configDirOf(configPath))
}

// configDirOf returns the directory part of a path with either separator, so
// a Windows-style record path is split correctly while running on macOS.
func configDirOf(p string) string {
	p = strings.TrimSpace(p)
	if i := strings.LastIndexAny(p, `/\`); i >= 0 {
		return p[:i]
	}
	return "."
}

// localPathForClean resolves a local credential path: placeholders are
// expanded (~ / $VAR / %VAR%) and `..` segments collapsed.
func localPathForClean(path string) string {
	return filepath.Clean(service.ExpandPath(path))
}

// rowSSHConfig parses and decrypts the row's SSH connection config.
func rowSSHConfig(row *model.AgentConfigFile, key []byte) (service.SshConfig, error) {
	var cfg service.SshConfig
	if err := cfg.Unmarshal(row.SshConfig); err != nil {
		return cfg, fmt.Errorf("SSH 配置解析失败: %v", err)
	}
	if err := cfg.DecryptSensitive(key); err != nil {
		return cfg, fmt.Errorf("SSH 凭据解密失败: %v", err)
	}
	return cfg, nil
}

// readCredentialDoc reads the credential document, "" when it is absent.
func readCredentialDoc(row *model.AgentConfigFile, key []byte, path string) (string, error) {
	switch row.Mode {
	case "local":
		data, err := os.ReadFile(localPathForClean(path))
		if errors.Is(err, os.ErrNotExist) {
			return "", nil
		}
		if err != nil {
			return "", fmt.Errorf("读取凭据文件失败: %v", err)
		}
		return string(data), nil
	case "ssh":
		cfg, err := rowSSHConfig(row, key)
		if err != nil {
			return "", err
		}
		return service.ReadRemoteFileIfExists(cfg, path, row.TargetOS)
	default:
		return "", fmt.Errorf("未知模式 %q", row.Mode)
	}
}

// writeCredentialDoc atomically replaces the credential document on the
// target machine. Both writers create the file 0600: dsh refuses a
// credentials document readable beyond its owner.
func writeCredentialDoc(row *model.AgentConfigFile, key []byte, path, content string) error {
	switch row.Mode {
	case "local":
		return service.WriteLocalFileAtomic(localPathForClean(path), content)
	case "ssh":
		cfg, err := rowSSHConfig(row, key)
		if err != nil {
			return err
		}
		return service.WriteRemoteFileAtomic(cfg, path, content, row.TargetOS)
	default:
		return fmt.Errorf("未知模式 %q", row.Mode)
	}
}

// credentialRefsOf collects the credential reference names the generated
// blocks carry (the value of the spec's reference field), deduplicated.
func credentialRefsOf(spec *model.AgentCredentialSpec, generated []map[string]any) []string {
	if spec == nil {
		return nil
	}
	var out []string
	for _, gen := range generated {
		provider, _ := gen["provider"].(map[string]any)
		if provider == nil {
			continue
		}
		if ref, ok := provider[spec.RefField].(string); ok && strings.TrimSpace(ref) != "" {
			out = append(out, strings.TrimSpace(ref))
		}
	}
	return uniqueSorted(out)
}

// credentialRefsStored parses a credential document into its reference map:
// the version-1 `refs:` section, or the pre-release flat top level.
func credentialRefsStored(content string) (map[string]string, error) {
	out := map[string]string{}
	if strings.TrimSpace(content) == "" {
		return out, nil
	}
	doc, err := parseYAMLDoc(content)
	if err != nil {
		return nil, err
	}
	if doc.root.Kind != yaml.MappingNode {
		return nil, errors.New("凭据文件顶层必须是映射（mapping）")
	}
	section := doc.root
	if nodeMappingValue(doc.root, "version") != nil {
		section = nodeMappingValue(doc.root, "refs")
		if section == nil {
			return out, nil
		}
	}
	for i := 0; i+1 < len(section.Content); i += 2 {
		key := section.Content[i].Value
		val := section.Content[i+1]
		if credentialRefRe.MatchString(key) && val.Kind == yaml.ScalarNode && strings.TrimSpace(val.Value) != "" {
			out[key] = val.Value
		}
	}
	return out, nil
}

// managedCredentialMissing reports whether the declared credential store does
// not hold the chosen token under every reference the generated blocks carry.
// 管理模型 views fold this into 待同步: after this feature lands on an existing
// row — or after a token rotation that the store has not seen — the config
// block itself may already match the file, which would hide the sync button
// and leave no way to write the credential. Read failures count as "not
// missing": the sync itself reports real write errors.
func managedCredentialMissing(row *model.AgentConfigFile, key []byte, spec *model.AgentCredentialSpec, token string, groups []managedGroupView) bool {
	if row == nil || spec == nil {
		return false
	}
	if strings.ToLower(strings.TrimSpace(spec.Format)) != "dsh-refs-v1" {
		return false
	}
	token = strings.TrimSpace(token)
	path := resolveConfigDirPath(row.Path, spec.PathForOS(row.TargetOS))
	if token == "" || path == "" {
		return false
	}
	generated := make([]map[string]any, 0, len(groups))
	for _, g := range groups {
		if g.Generated != nil {
			generated = append(generated, g.Generated)
		}
	}
	refs := credentialRefsOf(spec, generated)
	if len(refs) == 0 {
		return false
	}
	content, err := readCredentialDoc(row, key, path)
	if err != nil {
		return false
	}
	stored, err := credentialRefsStored(content)
	if err != nil {
		return false
	}
	for _, ref := range refs {
		if stored[ref] != token {
			return true
		}
	}
	return false
}

// upsertCredentialRef sets one credential reference while preserving the rest
// of the document — comments included. Layouts handled:
//
//   - absent / empty document → the version-1 layout (`version: 1` + `refs:`);
//   - a `version:`-stamped document → `refs.<name>`;
//   - a pre-release flat document (no `version:`) keeps its flat shape; dsh
//     migrates it in place on the next boot.
//
// Anything that is not a mapping is an error rather than silently overwritten:
// dsh refuses a document it cannot address, so clobbering one would leave the
// agent unable to start.
func upsertCredentialRef(content, name, value string) (string, error) {
	if !credentialRefRe.MatchString(name) {
		return "", fmt.Errorf("凭据引用名 %q 不是合法的环境变量名", name)
	}
	if value == "" {
		return "", errors.New("凭据值不能为空")
	}
	if strings.TrimSpace(content) == "" {
		return freshCredentialDoc(name, value).marshal()
	}
	doc, err := parseYAMLDoc(content)
	if err != nil {
		return "", err
	}
	if doc.root.Kind != yaml.MappingNode {
		return "", errors.New("凭据文件顶层必须是映射（mapping）")
	}
	if nodeMappingValue(doc.root, "version") != nil {
		if err := doc.set("refs."+name, value); err != nil {
			return "", err
		}
	} else if err := doc.set(name, value); err != nil {
		return "", err
	}
	return doc.marshal()
}

// freshCredentialDoc builds an empty version-1 credentials document holding
// one reference.
func freshCredentialDoc(name, value string) *yamlDoc {
	refs := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map", Content: []*yaml.Node{
		scalarNode("!!str", name),
		scalarNode("!!str", value),
	}}
	root := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map", Content: []*yaml.Node{
		scalarNode("!!str", "version"),
		scalarNode("!!int", "1"),
		scalarNode("!!str", "refs"),
		refs,
	}}
	return &yamlDoc{root: root}
}
