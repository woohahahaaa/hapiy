import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { AppShell } from '@/layouts/AppShell'
import { LoginPage } from '@/pages/LoginPage'
import { TopologyPage } from '@/pages/TopologyPage'
import { MonitorPage } from '@/pages/MonitorPage'
import { LogsPage } from '@/pages/LogsPage'
import { LogCapturePage } from '@/pages/LogCapturePage'
import { ProviderPage } from '@/pages/ProviderPage'
import { TokenPage } from '@/pages/TokenPage'
import { PolicyPage } from '@/pages/PolicyPage'
import { BaseUrlSettingsPage } from '@/pages/BaseUrlSettingsPage'
import { ChannelAffinityPage } from '@/pages/ChannelAffinityPage'
import { GeneralSettingsPage } from '@/pages/GeneralSettingsPage'
import { BillingSettingsPage } from '@/pages/BillingSettingsPage'
import { DebugSettingsPage } from '@/pages/DebugSettingsPage'
import { ThemeSettingsPage } from '@/pages/ThemeSettingsPage'
import { BackupSettingsPage } from '@/pages/BackupSettingsPage'
import { OtherSettingsPage } from '@/pages/OtherSettingsPage'
import { TokenUsageSettingsPage } from '@/pages/TokenUsageSettingsPage'
import { ProfilePage } from '@/pages/ProfilePage'
import { AgentConfigPage } from '@/pages/AgentConfigPage'
import { AgentRulesPage } from '@/pages/AgentRulesPage'
import { AuthGate } from '@/components/AuthGate'
import { CustomThemeApplier } from '@/components/CustomThemeApplier'
import { LanguageProvider } from '@/i18n/language-context'
import { Toaster } from '@/components/ui/toast'

// 帮助文档整页懒加载：markdown 渲染库只在打开帮助时才下载。
const HelpPage = lazy(() => import('@/pages/help/HelpPage').then((m) => ({ default: m.HelpPage })))

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* 帮助文档是独立全屏页面：不套 AppShell（没有系统菜单），也不要求登录态。 */}
        <Route
          path="/help"
          element={
            <Suspense fallback={null}>
              <HelpPage />
            </Suspense>
          }
        />
        <Route
          path="/*"
          element={
            <AuthGate>
              <LanguageProvider>
                <CustomThemeApplier />
                <AppShell>
                  <Routes>
                    <Route path="/" element={<TopologyPage />} />
                    <Route path="/monitor" element={<MonitorPage />} />
                    <Route path="/logs" element={<LogsPage />} />
                    <Route path="/logs/capture" element={<LogCapturePage />} />
                    <Route path="/provider" element={<ProviderPage />} />
                    <Route path="/token" element={<TokenPage />} />
                    <Route path="/channel-affinity" element={<ChannelAffinityPage />} />
                    <Route path="/policy/:type" element={<PolicyPage />} />
                    <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
                    <Route path="/settings/base-url" element={<BaseUrlSettingsPage />} />
                    <Route path="/settings/general" element={<GeneralSettingsPage />} />
                    <Route path="/settings/billing" element={<BillingSettingsPage />} />
                    {/* Debug 仅 dev 模式可用，生产构建不注册该路由 */}
                    {import.meta.env.DEV && (
                      <Route path="/settings/debug" element={<DebugSettingsPage />} />
                    )}
                    <Route path="/settings/backup" element={<BackupSettingsPage />} />
                    <Route path="/settings/theme" element={<ThemeSettingsPage />} />
                    <Route path="/settings/other" element={<OtherSettingsPage />} />
                    <Route path="/settings/token-usage" element={<TokenUsageSettingsPage />} />
                    <Route path="/profile" element={<ProfilePage />} />
                    <Route path="/agent" element={<AgentRulesPage />} />
                    <Route path="/agent/config" element={<AgentConfigPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </AppShell>
              </LanguageProvider>
            </AuthGate>
          }
        />
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}

export default App
