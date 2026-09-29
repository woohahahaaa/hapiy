import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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
import { OtherSettingsPage } from '@/pages/OtherSettingsPage'
import { TokenUsageSettingsPage } from '@/pages/TokenUsageSettingsPage'
import { ProfilePage } from '@/pages/ProfilePage'
import { AgentConfigPage } from '@/pages/AgentConfigPage'
import { AgentRulesPage } from '@/pages/AgentRulesPage'
import { AuthGate } from '@/components/AuthGate'
import { LanguageProvider } from '@/i18n/language-context'
import { Toaster } from '@/components/ui/toast'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <AuthGate>
              <LanguageProvider>
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
                    <Route path="/settings/debug" element={<DebugSettingsPage />} />
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
