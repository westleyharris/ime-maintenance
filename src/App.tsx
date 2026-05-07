import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { AssetProvider } from './context/AssetContext';
import RequireAuth from './components/RequireAuth';
import AppLayout from './layouts/AppLayout';
import Login from './pages/Login';
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
    <AuthProvider>
      <AssetProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />

            {/* All app routes require authentication */}
            <Route element={<RequireAuth />}>
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
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AssetProvider>
    </AuthProvider>
  );
}
