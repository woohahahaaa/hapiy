import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from '@/layouts/AppShell'
import { LoginPage } from '@/pages/LoginPage'
import { TopologyPage } from '@/pages/TopologyPage'
import { MonitorPage } from '@/pages/MonitorPage'
import { LogsPage } from '@/pages/LogsPage'
import { ProviderPage } from '@/pages/ProviderPage'
import { TokenPage } from '@/pages/TokenPage'
import { PricePage } from '@/pages/PricePage'
import { PolicyPage } from '@/pages/PolicyPage'
import { GeneralSettingsPage } from '@/pages/GeneralSettingsPage'
import { ProfilePage } from '@/pages/ProfilePage'
import { AuthGate } from '@/components/AuthGate'
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
              <AppShell>
                <Routes>
                  <Route path="/" element={<TopologyPage />} />
                  <Route path="/monitor" element={<MonitorPage />} />
                  <Route path="/logs" element={<LogsPage />} />
                  <Route path="/provider" element={<ProviderPage />} />
                  <Route path="/token" element={<TokenPage />} />
                  <Route path="/model" element={<PricePage />} />
                  <Route path="/policy/:type" element={<PolicyPage />} />
                  <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
                  <Route path="/settings/general" element={<GeneralSettingsPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </AppShell>
            </AuthGate>
          }
        />
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}

export default App
