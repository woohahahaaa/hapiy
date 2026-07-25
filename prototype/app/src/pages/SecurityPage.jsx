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

export default function SecurityPage() {
  const [basicAuth, setBasicAuth] = useState(true);
  const [passkey, setPasskey] = useState(false);
  const [botProtection, setBotProtection] = useState(true);
  const [twoFactor, setTwoFactor] = useState(false);
  const [rateLimit, setRateLimit] = useState(true);
  const [rateLimitCount, setRateLimitCount] = useState('1000');

  return (
    <div className="settings-scroll">
      <div style={{ marginBottom: 24 }}>
        <PageHeader icon="shield" title="安全设置" subtitle="认证、访问控制与防护" />
      </div>

      <div className="settings-section">
        <div className="settings-section-title">认证方式</div>
        <div className="settings-section-desc">配置用户登录和身份验证方式</div>

        <div className="settings-card">
          <div className="settings-card-header">
            <div className="settings-card-title">基本认证</div>
            <div className="settings-card-desc">用户名 + 密码登录，支持多用户</div>
          </div>
          <div className="settings-card-body">
            <Toggle label="启用用户名密码登录" checked={basicAuth} onChange={setBasicAuth} />
            <Toggle label="微软验证器二次验证 (2FA)" desc="登录时要求输入二次验证码" checked={twoFactor} onChange={setTwoFactor} />
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-header">
            <div className="settings-card-title">Passkey / WebAuthn</div>
            <div className="settings-card-desc">使用生物识别或硬件密钥免密登录</div>
          </div>
          <div className="settings-card-body">
            <Toggle label="启用 Passkey" desc="支持指纹、面部识别或安全密钥" checked={passkey} onChange={setPasskey} />
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">访问保护</div>
        <div className="settings-section-desc">防止暴力破解和恶意访问</div>

        <div className="settings-card">
          <div className="settings-card-body">
            <Toggle label="启用防暴力破解" desc="登录失败次数过多后临时锁定账户" checked={botProtection} onChange={setBotProtection} />
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">请求限制</div>
        <div className="settings-section-desc">控制 API 请求频率限制</div>

        <div className="settings-card">
          <div className="settings-card-body">
            <Toggle label="启用请求频率限制" desc="限制每个令牌的每分钟请求次数" checked={rateLimit} onChange={setRateLimit} />
            <Field
              label="每分钟最大请求数"
              hint="超过限制后返回 429 Too Many Requests"
              type="number"
              value={rateLimitCount}
              onChange={setRateLimitCount}
              disabled={!rateLimit}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
