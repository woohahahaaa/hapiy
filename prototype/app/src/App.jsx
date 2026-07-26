import { useEffect, useState } from 'react';
import '@xyflow/react/dist/style.css';
import { ProviderStore } from './store/ProviderStore';
import { RuleStore } from './store/RuleStore';
import { PriceStore } from './store/PriceStore';
import Sidebar from './components/Sidebar';
import TopologyPage from './pages/TopologyPage';
import MonitorPage from './pages/MonitorPage';
import ProviderPage from './pages/ProviderPage';
import TokenPage from './pages/TokenPage';
import PricePage from './pages/PricePage';
import PolicyPage from './pages/PolicyPage';
import SettingsPage from './pages/SettingsPage';
import ProfilePage from './pages/ProfilePage';
import './App.css';

const mobileSidebarQuery = '(max-width: 640px)';

function useResponsiveSidebar() {
  const [expanded, setExpanded] = useState(
    () => !window.matchMedia(mobileSidebarQuery).matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(mobileSidebarQuery);
    const collapseOnMobile = (event) => {
      if (event.matches) setExpanded(false);
    };

    mediaQuery.addEventListener('change', collapseOnMobile);
    return () => mediaQuery.removeEventListener('change', collapseOnMobile);
  }, []);

  return [expanded, setExpanded];
}

function App() {
  const [expanded, setExpanded] = useResponsiveSidebar();
  const [page, setPage] = useState({ section: 'topology' });

  function handleNavigate(section, sub) {
    setPage({ section, sub: sub || null });
  }

  return (
    <ProviderStore>
    <PriceStore>
    <RuleStore>
    <div className="app-shell">
      <Sidebar
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        activeSection={page.section}
        activeSub={page.sub}
        onNavigate={handleNavigate}
      />
      <main className={`main-area ${expanded ? 'sidebar-expanded' : 'sidebar-collapsed'}`}>
        {page.section === 'topology' && <TopologyPage />}
        {page.section === 'monitor' && <MonitorPage sub={page.sub} />}
        {page.section === 'provider' && <ProviderPage />}
        {page.section === 'token' && <TokenPage />}
        {page.section === 'policy' && <PolicyPage sub={page.sub} />}
        {page.section === 'price' && <PricePage />}
        {page.section === 'settings' && <SettingsPage />}
        {page.section === 'profile' && <ProfilePage />}
      </main>
    </div>
    </RuleStore>
    </PriceStore>
    </ProviderStore>
  );
}

export default App;
