import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppShell } from '@/layouts/AppShell'
import { TopologyPage } from '@/pages/TopologyPage'
import { MonitorPage } from '@/pages/MonitorPage'
import { LogsPage } from '@/pages/LogsPage'
import { ProviderPage } from '@/pages/ProviderPage'
import { TokenPage } from '@/pages/TokenPage'
import { PricePage } from '@/pages/PricePage'
import { PolicyPage } from '@/pages/PolicyPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { ProfilePage } from '@/pages/ProfilePage'
import { ToastContainer } from '@/components/ui/toast'

function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<TopologyPage />} />
          <Route path="/monitor" element={<MonitorPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/provider" element={<ProviderPage />} />
          <Route path="/token" element={<TokenPage />} />
          <Route path="/price" element={<PricePage />} />
          <Route path="/policy/:type" element={<PolicyPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Routes>
      </AppShell>
      <ToastContainer />
    </BrowserRouter>
  )
}

export default App
