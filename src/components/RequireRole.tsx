import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../types/auth';

interface Props {
  roles: UserRole[];
}

export default function RequireRole({ roles }: Props) {
  const { profile, loading } = useAuth();
  if (loading) return null;
  if (!profile || !roles.includes(profile.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}
