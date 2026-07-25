import { useState } from 'react';
import PageHeader from './PageHeader';
import './settings.css';

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

export default function ProfilePage() {
  const [username, setUsername] = useState('Admin');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [twoFactor, setTwoFactor] = useState(false);

  return (
    <div className="settings-scroll">
      <div style={{ marginBottom: 24 }}>
        <PageHeader icon="person" title="用户资料" subtitle="管理员账户设置" />
      </div>

      <div className="settings-section">
        <div className="settings-section-title">用户头像</div>
        <div className="settings-section-desc">点击更换头像，支持 JPG / PNG，最大 2MB</div>

        <div className="settings-card">
          <div className="settings-card-body" style={{ alignItems: 'center' }}>
            <div style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: 'var(--sidebar-primary)',
              color: 'var(--sidebar-primary-foreground)',
              fontSize: 28,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
            }}>
              A
            </div>
            <span className="settings-field-hint" style={{ marginTop: 6 }}>管理员头像</span>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">账户信息</div>
        <div className="settings-section-desc">修改登录用户名和密码</div>

        <div className="settings-card">
          <div className="settings-card-body">
            <Field label="用户 ID" hint="登录时使用的用户名，修改后需重新登录" value={username} onChange={setUsername} />
            <Field label="当前密码" type="password" hint="输入当前密码以验证身份" value={password} onChange={setPassword} placeholder="请输入当前密码" />
            <Field label="新密码" type="password" hint="留空则不修改密码" value={newPassword} onChange={setNewPassword} placeholder="留空则不修改" />
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">安全设置</div>
        <div className="settings-section-desc">增强账户安全性</div>

        <div className="settings-card">
          <div className="settings-card-body">
            <Toggle
              label="启用微软验证器双重登录"
              desc="开启后，登录时需要输入微软验证器生成的 6 位一次性验证码"
              checked={twoFactor}
              onChange={setTwoFactor}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
