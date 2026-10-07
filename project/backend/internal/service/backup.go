package service

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/hapiy/hapiy/internal/model"
	"gorm.io/gorm"
)

// Data-backup settings keys (stored in the settings table).
const (
	SettingBackupModules   = "backup_modules"
	SettingBackupFrequency = "backup_frequency"
	SettingBackupPath      = "backup_path"
)

// Default backup frequency (never / daily / weekly) and relative path.
const (
	BackupFrequencyNever  = "never"
	BackupFrequencyDaily  = "daily"
	BackupFrequencyWeekly = "weekly"

	DefaultBackupPath = "backups"

	backupSourceManual     = "manual"
	backupSourceAuto       = "auto"
	backupSourcePreRestore = "pre-restore"

	backupManifestTable = "_backup_manifest"
)

const defaultBackupModulesJSON = `["topology","providers","tokens","policy","agent","settings"]`

// backupModuleOrder is the canonical module order used for hashing, files and
// the UI. BackupModuleTables maps each module to the tables it owns. A module
// with a missing table (older schema) is skipped.
var backupModuleOrder = []string{"topology", "providers", "tokens", "policy", "agent", "settings", "usage", "logs"}

var BackupModuleTables = map[string][]string{
	// 转发拓扑：节点、连线、布局与历史版本
	"topology": {
		"topology_configs", "topology_nodes", "topology_slot_assignments",
		"topology_states", "topology_versions", "layout_configs",
	},
	// 供应商：供应商、渠道与密钥
	"providers": {"providers", "channels"},
	// 令牌：访问令牌与配额
	"tokens": {"tokens"},
	// 请求处理规则：改写、故障转移、亲和性等（含自动禁用状态）
	"policy": {
		"rewrite_rules", "response_rewrite_rules", "failover_rules",
		"failover_hit_counters", "heartbeat_rules", "concurrency_rules",
		"concurrency_window_counters", "auto_disable_states", "disabled_records",
		"request_channel_histories",
	},
	// 接管 Agent：配置文件与管理规则
	"agent": {
		"agent_config_files", "agent_config_versions", "agent_type_rules",
		"managed_agent_providers", "agent_model_config_sources",
	},
	// 系统设置：设置、BaseURL 来源名、表格配置与用户
	"settings": {"settings", "base_url_paths", "table_configs", "users"},
	// 使用记录：请求与用量统计
	"usage": {"logs", "usage_counters", "usage_stats"},
	// 日志抓取：抓取的请求与响应日志
	"logs": {"log_captures"},
}

// backupBaseDir is the directory relative backup paths resolve against: the
// directory holding the live database. Set once from main via
// SetBackupBaseDir; empty falls back to ".".
var backupBaseDir string

func SetBackupBaseDir(dir string) { backupBaseDir = dir }

func BackupBaseDir() string {
	if backupBaseDir == "" {
		return "."
	}
	return backupBaseDir
}

// KnownBackupModules returns the selectable module ids in display order.
func KnownBackupModules() []string {
	return append([]string(nil), backupModuleOrder...)
}

// NormalizeBackupModules validates and deduplicates module ids, preserving the
// caller's order.
func NormalizeBackupModules(modules []string) ([]string, error) {
	seen := make(map[string]bool, len(modules))
	out := make([]string, 0, len(modules))
	for _, raw := range modules {
		id := strings.TrimSpace(raw)
		if id == "" {
			continue
		}
		if _, ok := BackupModuleTables[id]; !ok {
			return nil, fmt.Errorf("unknown backup module: %s", id)
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out, nil
}

func defaultBackupModules() []string {
	var modules []string
	if err := json.Unmarshal([]byte(defaultBackupModulesJSON), &modules); err != nil {
		return nil
	}
	return modules
}

// ReadBackupModules returns the saved module selection, falling back to the
// built-in defaults (all modules except usage records and log captures).
func ReadBackupModules(db *gorm.DB) []string {
	val, err := GetSetting(db, SettingBackupModules)
	if err != nil || strings.TrimSpace(val) == "" {
		return defaultBackupModules()
	}
	var modules []string
	if err := json.Unmarshal([]byte(val), &modules); err != nil {
		return defaultBackupModules()
	}
	normalized, err := NormalizeBackupModules(modules)
	if err != nil || len(normalized) == 0 {
		return defaultBackupModules()
	}
	return normalized
}

// ReadBackupFrequency returns never / daily / weekly; invalid values fall back
// to weekly.
func ReadBackupFrequency(db *gorm.DB) string {
	val, err := GetSetting(db, SettingBackupFrequency)
	if err != nil {
		return BackupFrequencyWeekly
	}
	switch val {
	case BackupFrequencyNever, BackupFrequencyDaily, BackupFrequencyWeekly:
		return val
	default:
		return BackupFrequencyWeekly
	}
}

// ReadBackupPath returns the saved relative backup path.
func ReadBackupPath(db *gorm.DB) string {
	val, err := GetSetting(db, SettingBackupPath)
	if err != nil || strings.TrimSpace(val) == "" {
		return DefaultBackupPath
	}
	return strings.TrimSpace(val)
}

// ResolveBackupDir turns the configured relative path into an absolute
// directory. Absolute inputs pass through unchanged.
func ResolveBackupDir(relative string) string {
	p := strings.TrimSpace(relative)
	if p == "" {
		p = DefaultBackupPath
	}
	if filepath.IsAbs(p) {
		return filepath.Clean(p)
	}
	return filepath.Clean(filepath.Join(BackupBaseDir(), p))
}

func backupFrequencyInterval(frequency string) (time.Duration, bool) {
	switch frequency {
	case BackupFrequencyDaily:
		return 24 * time.Hour, true
	case BackupFrequencyWeekly:
		return 7 * 24 * time.Hour, true
	default:
		return 0, false
	}
}

func backupTablesFor(modules []string) []string {
	selected := make(map[string]bool, len(modules))
	for _, m := range modules {
		selected[m] = true
	}
	var tables []string
	for _, m := range backupModuleOrder {
		if !selected[m] {
			continue
		}
		tables = append(tables, BackupModuleTables[m]...)
	}
	return tables
}

// BackupContentDigest hashes the current content of the selected modules so
// two runs can be compared without writing a file. Tables are hashed in
// canonical order and rows in rowid order.
func BackupContentDigest(db *gorm.DB, modules []string) (string, error) {
	h := sha256.New()
	for _, table := range backupTablesFor(modules) {
		if !db.Migrator().HasTable(table) {
			continue
		}
		if err := hashBackupTable(db, h, table); err != nil {
			return "", err
		}
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func hashBackupTable(db *gorm.DB, h io.Writer, table string) error {
	rows, err := db.Raw(fmt.Sprintf(`SELECT * FROM "%s" ORDER BY rowid`, table)).Rows()
	if err != nil {
		// Tables without rowid (none in the current schema) fall back to scan
		// order; content changes still alter the digest.
		rows, err = db.Raw(fmt.Sprintf(`SELECT * FROM "%s"`, table)).Rows()
		if err != nil {
			return fmt.Errorf("hash %s: %w", table, err)
		}
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return err
	}
	fmt.Fprintf(h, "table:%s:%d\n", table, len(cols))
	values := make([]any, len(cols))
	ptrs := make([]any, len(cols))
	for i := range values {
		ptrs[i] = &values[i]
	}
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return err
		}
		for _, v := range values {
			writeDigestValue(h, v)
		}
		io.WriteString(h, "\n")
	}
	return rows.Err()
}

func writeDigestValue(w io.Writer, v any) {
	switch t := v.(type) {
	case nil:
		io.WriteString(w, "n|")
	case int64:
		fmt.Fprintf(w, "i%d|", t)
	case float64:
		fmt.Fprintf(w, "f%d|", math.Float64bits(t))
	case bool:
		fmt.Fprintf(w, "b%v|", t)
	case []byte:
		fmt.Fprintf(w, "x%d:", len(t))
		w.Write(t)
		io.WriteString(w, "|")
	case string:
		fmt.Fprintf(w, "s%d:", len(t))
		io.WriteString(w, t)
		io.WriteString(w, "|")
	case time.Time:
		io.WriteString(w, "t"+t.UTC().Format(time.RFC3339Nano)+"|")
	default:
		fmt.Fprintf(w, "?%v|", t)
	}
}

// BackupOptions configures one backup run.
type BackupOptions struct {
	// Modules to include; empty uses the saved selection.
	Modules []string
	// Path overrides the saved relative backup path for this run.
	Path string
	// Source is manual / auto / pre-restore (defaults to manual).
	Source string
	// Force skips the "no changes" check (used for pre-restore safety copies).
	Force bool
}

// BackupResult reports what a run produced.
type BackupResult struct {
	Record      *model.BackupRecord
	FileCreated bool
}

// RunBackup creates a backup of the selected modules. When the content matches
// the previous record, no file is written and an unchanged record is added
// instead.
func RunBackup(db *gorm.DB, opts BackupOptions) (*BackupResult, error) {
	modules, err := NormalizeBackupModules(opts.Modules)
	if err != nil {
		return nil, err
	}
	if len(modules) == 0 {
		modules = ReadBackupModules(db)
	}
	if len(modules) == 0 {
		return nil, errors.New("no backup modules selected")
	}
	path := strings.TrimSpace(opts.Path)
	if path == "" {
		path = ReadBackupPath(db)
	}
	dir := ResolveBackupDir(path)
	source := opts.Source
	if source == "" {
		source = backupSourceManual
	}

	digest, err := BackupContentDigest(db, modules)
	if err != nil {
		return nil, err
	}

	if !opts.Force {
		var last model.BackupRecord
		err := db.Order("created_at desc, rowid desc").First(&last).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		if err == nil && last.Digest != "" && last.Digest == digest {
			record := &model.BackupRecord{
				SizeBytes:   0,
				ModulesList: modules,
				Path:        dir,
				Source:      source,
				Unchanged:   true,
				Digest:      digest,
			}
			if err := db.Create(record).Error; err != nil {
				return nil, err
			}
			return &BackupResult{Record: record, FileCreated: false}, nil
		}
	}

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create backup dir: %w", err)
	}
	fileName := uniqueBackupFileName(dir, time.Now())
	filePath := filepath.Join(dir, fileName)
	if err := writeBackupFile(db, filePath, modules); err != nil {
		_ = os.Remove(filePath)
		return nil, err
	}
	info, err := os.Stat(filePath)
	if err != nil {
		_ = os.Remove(filePath)
		return nil, err
	}
	record := &model.BackupRecord{
		SizeBytes:   info.Size(),
		ModulesList: modules,
		Path:        dir,
		FileName:    fileName,
		Source:      source,
		Digest:      digest,
	}
	if err := db.Create(record).Error; err != nil {
		_ = os.Remove(filePath)
		return nil, err
	}
	return &BackupResult{Record: record, FileCreated: true}, nil
}

func uniqueBackupFileName(dir string, now time.Time) string {
	base := "hapiy-" + now.Format("20060102-150405")
	name := base + ".db"
	for i := 2; ; i++ {
		if _, err := os.Stat(filepath.Join(dir, name)); errors.Is(err, os.ErrNotExist) {
			return name
		}
		name = fmt.Sprintf("%s-%d.db", base, i)
	}
}

// writeBackupFile materialises a backup: a fresh SQLite file containing only
// the selected modules' tables plus a manifest row list. Schema is copied via
// CREATE TABLE AS SELECT — enough to restore data by column name.
func writeBackupFile(db *gorm.DB, destPath string, modules []string) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	ctx := context.Background()
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()

	if _, err := conn.ExecContext(ctx, "ATTACH DATABASE "+sqlQuote(destPath)+" AS bak"); err != nil {
		return fmt.Errorf("attach backup file: %w", err)
	}
	defer conn.ExecContext(ctx, "DETACH DATABASE bak")

	for _, table := range backupTablesFor(modules) {
		if !db.Migrator().HasTable(table) {
			continue
		}
		if _, err := conn.ExecContext(ctx,
			fmt.Sprintf(`CREATE TABLE "bak"."%s" AS SELECT * FROM "main"."%s"`, table, table),
		); err != nil {
			return fmt.Errorf("copy table %s: %w", table, err)
		}
	}

	if _, err := conn.ExecContext(ctx,
		fmt.Sprintf(`CREATE TABLE "bak"."%s" ("key" TEXT PRIMARY KEY, "value" TEXT)`, backupManifestTable),
	); err != nil {
		return fmt.Errorf("create manifest: %w", err)
	}
	modulesJSON, err := json.Marshal(modules)
	if err != nil {
		return err
	}
	manifest := map[string]string{
		"modules":    string(modulesJSON),
		"created_at": time.Now().UTC().Format(time.RFC3339),
	}
	for key, value := range manifest {
		if _, err := conn.ExecContext(ctx,
			fmt.Sprintf(`INSERT INTO "bak"."%s" ("key", "value") VALUES (?, ?)`, backupManifestTable), key, value,
		); err != nil {
			return fmt.Errorf("write manifest: %w", err)
		}
	}
	return nil
}

// sqlQuote renders a Go string as a single-quoted SQL literal.
func sqlQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

// ListBackupRecords returns history entries newest first.
func ListBackupRecords(db *gorm.DB, limit, offset int) ([]model.BackupRecord, int64, error) {
	records := make([]model.BackupRecord, 0)
	query := db.Model(&model.BackupRecord{})
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if limit <= 0 {
		limit = 50
	}
	if err := db.Order("created_at desc, rowid desc").Limit(limit).Offset(offset).Find(&records).Error; err != nil {
		return nil, 0, err
	}
	return records, total, nil
}

// BackupFilePath returns the on-disk path of a record's file.
func BackupFilePath(db *gorm.DB, id string) (string, error) {
	var record model.BackupRecord
	if err := db.First(&record, "id = ?", id).Error; err != nil {
		return "", err
	}
	if record.FileName == "" {
		return "", errors.New("该记录没有备份文件")
	}
	return filepath.Join(record.Path, filepath.Base(record.FileName)), nil
}

// DeleteBackupRecord removes a history entry and its file (when it has one).
func DeleteBackupRecord(db *gorm.DB, id string) error {
	var record model.BackupRecord
	if err := db.First(&record, "id = ?", id).Error; err != nil {
		return err
	}
	if record.FileName != "" {
		path := filepath.Join(record.Path, filepath.Base(record.FileName))
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return db.Delete(&model.BackupRecord{}, "id = ?", id).Error
}

// RestoreResult reports what a restore applied.
type RestoreResult struct {
	Modules      []string
	SafetyBackup *model.BackupRecord
}

// RestoreBackup restores the modules stored in a history record's file. It
// writes a pre-restore safety backup (same modules, always on disk) first, then
// replaces the live rows table by table inside one transaction.
func RestoreBackup(db *gorm.DB, id string) (*RestoreResult, error) {
	var record model.BackupRecord
	if err := db.First(&record, "id = ?", id).Error; err != nil {
		return nil, err
	}
	if record.Unchanged || record.FileName == "" {
		return nil, errors.New("该记录没有备份文件，无法恢复")
	}
	filePath := filepath.Join(record.Path, filepath.Base(record.FileName))
	if _, err := os.Stat(filePath); err != nil {
		return nil, fmt.Errorf("backup file missing: %w", err)
	}

	modules, err := readBackupManifest(db, filePath)
	if err != nil {
		return nil, err
	}
	if len(modules) == 0 {
		return nil, errors.New("备份文件中没有可恢复的模块")
	}

	safety, err := RunBackup(db, BackupOptions{
		Modules: modules,
		Source:  backupSourcePreRestore,
		Force:   true,
	})
	if err != nil {
		return nil, fmt.Errorf("pre-restore backup: %w", err)
	}

	if err := applyBackupFile(db, filePath, modules); err != nil {
		return nil, err
	}
	return &RestoreResult{Modules: modules, SafetyBackup: safety.Record}, nil
}

// readBackupManifest opens the file read-only, verifies integrity and returns
// the module list stored inside.
func readBackupManifest(db *gorm.DB, filePath string) ([]string, error) {
	var modules []string
	err := withAttachedBackup(db, filePath, func(ctx context.Context, conn *sql.Conn) error {
		var raw string
		if err := conn.QueryRowContext(ctx,
			fmt.Sprintf(`SELECT "value" FROM "bak"."%s" WHERE "key" = 'modules'`, backupManifestTable),
		).Scan(&raw); err != nil {
			return fmt.Errorf("read backup manifest: %w", err)
		}
		if err := json.Unmarshal([]byte(raw), &modules); err != nil {
			return fmt.Errorf("parse backup manifest: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return NormalizeBackupModules(modules)
}

func withAttachedBackup(db *gorm.DB, filePath string, fn func(ctx context.Context, conn *sql.Conn) error) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	ctx := context.Background()
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()

	if _, err := conn.ExecContext(ctx, "ATTACH DATABASE "+sqlQuote(filePath)+" AS bak"); err != nil {
		return fmt.Errorf("attach backup file: %w", err)
	}
	defer conn.ExecContext(ctx, "DETACH DATABASE bak")

	var integrity string
	if err := conn.QueryRowContext(ctx, "PRAGMA bak.integrity_check").Scan(&integrity); err != nil {
		return fmt.Errorf("integrity check: %w", err)
	}
	if integrity != "ok" {
		return fmt.Errorf("backup file integrity check failed: %s", integrity)
	}
	return fn(ctx, conn)
}

// applyBackupFile replaces the live rows of every table owned by the backup's
// modules. Tables missing on either side are skipped; a column present in the
// live schema but absent from the file keeps its default.
func applyBackupFile(db *gorm.DB, filePath string, modules []string) error {
	return withAttachedBackup(db, filePath, func(ctx context.Context, conn *sql.Conn) error {
		tx, err := conn.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()

		for _, table := range backupTablesFor(modules) {
			if !db.Migrator().HasTable(table) {
				continue
			}
			srcCols, err := tableColumns(ctx, tx, table, "bak")
			if err != nil {
				return err
			}
			liveCols, err := tableColumns(ctx, tx, table, "main")
			if err != nil {
				return err
			}
			cols := intersectColumns(srcCols, liveCols)
			if len(cols) == 0 {
				continue
			}
			quoted := make([]string, len(cols))
			for i, col := range cols {
				quoted[i] = `"` + col + `"`
			}
			list := strings.Join(quoted, ", ")
			if _, err := tx.ExecContext(ctx, fmt.Sprintf(`DELETE FROM "main"."%s"`, table)); err != nil {
				return fmt.Errorf("clear %s: %w", table, err)
			}
			if _, err := tx.ExecContext(ctx,
				fmt.Sprintf(`INSERT INTO "main"."%s" (%s) SELECT %s FROM "bak"."%s"`, table, list, list, table),
			); err != nil {
				return fmt.Errorf("restore %s: %w", table, err)
			}
		}
		return tx.Commit()
	})
}

func tableColumns(ctx context.Context, tx *sql.Tx, table, schema string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, "SELECT name FROM pragma_table_info(?, ?)", table, schema)
	if err != nil {
		return nil, fmt.Errorf("read %s.%s columns: %w", schema, table, err)
	}
	defer rows.Close()
	var cols []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		cols = append(cols, name)
	}
	return cols, rows.Err()
}

func intersectColumns(src, live []string) []string {
	liveSet := make(map[string]bool, len(live))
	for _, col := range live {
		liveSet[col] = true
	}
	out := make([]string, 0, len(src))
	for _, col := range src {
		if liveSet[col] {
			out = append(out, col)
		}
	}
	return out
}

// StartBackupScheduler runs automatic backups. It reads frequency, modules and
// path from settings on every tick, so changes take effect without a restart.
// A run is due when the newest history entry is older than the interval; when
// no history exists the first run happens shortly after startup.
func StartBackupScheduler(db *gorm.DB) {
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			frequency := ReadBackupFrequency(db)
			interval, enabled := backupFrequencyInterval(frequency)
			if !enabled {
				continue
			}
			var last model.BackupRecord
			err := db.Order("created_at desc, rowid desc").First(&last).Error
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				log.Printf("backup scheduler: read history: %v", err)
				continue
			}
			if err == nil && time.Since(last.CreatedAt) < interval {
				continue
			}
			modules := ReadBackupModules(db)
			if len(modules) == 0 {
				continue
			}
			result, err := RunBackup(db, BackupOptions{
				Modules: modules,
				Path:    ReadBackupPath(db),
				Source:  backupSourceAuto,
			})
			if err != nil {
				log.Printf("backup scheduler: %v", err)
				continue
			}
			if result.FileCreated {
				log.Printf("backup scheduler: wrote %s", result.Record.FileName)
			} else {
				log.Printf("backup scheduler: no changes, recorded only")
			}
		}
	}()
}
