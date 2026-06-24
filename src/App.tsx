import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ScopeProvider } from './context/ScopeContext';
import { AssetProvider } from './context/AssetContext';
import RequireAuth from './components/RequireAuth';
import RequireRole from './components/RequireRole';
import AppLayout from './layouts/AppLayout';
import Login from './pages/Login';
import SetPassword from './pages/SetPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import Assets from './pages/Assets';
import WorkOrders from './pages/WorkOrders';
import Findings from './pages/Findings';
import Reports from './pages/Reports';
import Ultrasound from './pages/Ultrasound';
import Admin from './pages/Admin';
import SettingsPage from './pages/Settings';

export default function App() {
  return (
    <AuthProvider>
      <ScopeProvider>
      <AssetProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/set-password" element={<SetPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            {/* All app routes require authentication */}
            <Route element={<RequireAuth />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/assets" element={<Assets />} />
                <Route path="/work-orders" element={<WorkOrders />} />
                <Route path="/findings" element={<Findings />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/ultrasound" element={<Ultrasound />} />
                <Route element={<RequireRole roles={['ime_admin']} />}>
                  <Route path="/admin" element={<Admin />} />
                </Route>
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AssetProvider>
      </ScopeProvider>
    </AuthProvider>
  );
}
