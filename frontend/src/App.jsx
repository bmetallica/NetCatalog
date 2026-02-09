import { useState } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Server, History, Settings, Network, Menu, X, Activity
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Hosts from './pages/Hosts';
import HostDetail from './pages/HostDetail';
import ScanHistory from './pages/ScanHistory';
import SettingsPage from './pages/Settings';
import Availability from './pages/Availability';
import NotFound from './pages/NotFound';

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/hosts', label: 'Hosts', icon: Server },
    { path: '/availability', label: 'Verfuegbarkeit', icon: Activity },
    { path: '/scans', label: 'Scan-Verlauf', icon: History },
    { path: '/settings', label: 'Einstellungen', icon: Settings },
  ];

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="app-layout">
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`}
        onClick={closeSidebar}
      />
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <div className="logo-icon">
            <Network size={20} />
          </div>
          <h1>NetCatalog</h1>
        </div>
        <nav className="sidebar-nav">
          {navItems.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              className={({ isActive }) =>
                `nav-item ${isActive ? 'active' : ''}`
              }
              onClick={closeSidebar}
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/hosts" element={<Hosts />} />
          <Route path="/hosts/:id" element={<HostDetail />} />
          <Route path="/availability" element={<Availability />} />
          <Route path="/scans" element={<ScanHistory />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <button
        className="mobile-toggle"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
      </button>
    </div>
  );
}

export default App;
