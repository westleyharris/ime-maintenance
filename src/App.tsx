import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AssetProvider } from './context/AssetContext';
import AppLayout from './layouts/AppLayout';
import Dashboard from './pages/Dashboard';
import Assets from './pages/Assets';
import WorkOrders from './pages/WorkOrders';
import Inspections from './pages/Inspections';
import PMCalendar from './pages/PMCalendar';
import Reports from './pages/Reports';
import Vibration from './pages/Vibration';
import Admin from './pages/Admin';
import SettingsPage from './pages/Settings';

export default function App() {
  return (
    <AssetProvider>
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/assets" element={<Assets />} />
          <Route path="/work-orders" element={<WorkOrders />} />
          <Route path="/inspections" element={<Inspections />} />
          <Route path="/pm-calendar" element={<PMCalendar />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/vibration" element={<Vibration />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </AssetProvider>
  );
}
