import { useState } from 'react';
import PageHeader from './PageHeader';
import './settings.css';

function Toggle({ label, desc, checked, onChange }) {
  return (
    <div className="settings-switch-row">
      <div>
        <div className="settings-switch-label">{label}</div>
        {desc && <div className="settings-switch-desc">{desc}</div>}
      </div>
      <button
        className={`settings-toggle ${checked ? 'on' : ''}`}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

function Field({ label, hint, type = 'text', value, onChange, disabled, placeholder }) {
  return (
    <div className="settings-field">
      <label className="settings-field-label">{label}</label>
      <input
        className="settings-field-input"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
      />
      {hint && <span className="settings-field-hint">{hint}</span>}
    </div>
  );
}

function StatBar({ label, current, max, unit }) {
  const pct = max > 0 ? Math.round((current / max) * 100) : 0;
  return (
    <div className="settings-stat">
      <div className="settings-stat-label">{label}</div>
      <div className="settings-stat-bar">
        <div className="settings-stat-fill" style={{ width: pct + '%' }} />
      </div>
      <div className="settings-stat-meta">
        <span>{current}{unit} / {max}{unit}</span>
        <span>{pct}%</span>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [botProtection, setBotProtection] = useState(true);
  const [diskCache, setDiskCache] = useState(true);
  const [diskThreshold, setDiskThreshold] = useState('32');
  const [diskMax, setDiskMax] = useState('512');
  const [diskPath, setDiskPath] = useState('');
  const [monitor, setMonitor] = useState(true);
  const [cpuThreshold, setCpuThreshold] = useState('80');
  const [memThreshold, setMemThreshold] = useState('75');
  const [diskThreshold2, setDiskThreshold2] = useState('90');

  const diskUsage = 128;
  const diskMaxVal = Number(diskMax) || 512;
  const memUsed = 256;
  const memTotal = 1024;

  return (
    <div className="settings-scroll">
      <div style={{ marginBottom: 24 }}>
        <PageHeader title="系统设置" subtitle="安全、缓存与性能监控" />
      </div>

      <div className="settings-section">
        <div className="settings-section-title">安全</div>
        <div className="settings-section-desc">访问保护与防暴力破解</div>

        <div className="settings-card">
          <div className="settings-card-body">
            <Toggle label="启用防暴力破解" desc="登录失败次数过多后临时锁定账户，防止密码爆破" checked={botProtection} onChange={setBotProtection} />
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">磁盘缓存</div>
        <div className="settings-section-desc">启用后，请求体大于阈值时临时写入磁盘而非内存，大幅降低内存占用。推荐使用 SSD。</div>
        <div className="settings-card">
          <div className="settings-card-body">
            <Toggle label="启用磁盘缓存" checked={diskCache} onChange={setDiskCache} />
            <div className="settings-grid-2">
              <Field label="磁盘缓存阈值 (MB)" hint="请求体超过此大小时使用磁盘缓存" type="number" value={diskThreshold} onChange={setDiskThreshold} disabled={!diskCache} />
              <Field label="最大磁盘缓存 (MB)" hint="缓存总量上限，防止占满磁盘" type="number" value={diskMax} onChange={setDiskMax} disabled={!diskCache} />
            </div>
            <Field label="缓存目录" hint="留空使用系统临时目录" value={diskPath} onChange={setDiskPath} disabled={!diskCache} placeholder="留空使用系统临时目录" />
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">系统性能监控</div>
        <div className="settings-section-desc">当系统资源超过阈值时，新的转发请求将被拒绝（返回 503），防止服务崩溃。</div>
        <div className="settings-card">
          <div className="settings-card-body">
            <Toggle label="启用性能监控" checked={monitor} onChange={setMonitor} />
            <div className="settings-grid-2">
              <Field label="CPU 阈值 (%)" type="number" value={cpuThreshold} onChange={setCpuThreshold} disabled={!monitor} />
              <Field label="内存阈值 (%)" type="number" value={memThreshold} onChange={setMemThreshold} disabled={!monitor} />
            </div>
            <Field label="磁盘阈值 (%)" type="number" value={diskThreshold2} onChange={setDiskThreshold2} disabled={!monitor} />
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">系统状态</div>
        <div className="settings-section-desc">当前系统资源使用情况（Mock 数据）</div>
        <div className="settings-actions" style={{ marginBottom: 14 }}>
          <button className="settings-btn">刷新状态</button>
          <button className="settings-btn">重置统计</button>
          <button className="settings-btn danger">清理不活跃缓存</button>
        </div>
        <div className="settings-grid-2">
          <StatBar label="磁盘缓存用量" current={diskUsage} max={diskMaxVal} unit=" MB" />
          <StatBar label="系统内存" current={memUsed} max={memTotal} unit=" MB" />
        </div>
        <div className="settings-stat" style={{ marginTop: 14 }}>
          <div className="settings-stat-label">连接池</div>
          <div className="settings-stat-meta">
            <span>HTTP 连接池: MaxIdleConns = 500</span>
            <span>活跃连接: 12</span>
          </div>
          <div className="settings-stat-meta">
            <span>混合缓存: Redis 优先 + 内存 LRU 降级</span>
            <span>缓存命中率: 87.3%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
