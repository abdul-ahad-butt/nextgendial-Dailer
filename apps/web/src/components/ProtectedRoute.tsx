import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function ProtectedRoute({ allowedRole }: { allowedRole: 'admin' | 'agent' }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <span className="spinner" aria-label="Loading..." />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== allowedRole) {
    // Redirect admins to admin dashboard, agents to agent dashboard
    return <Navigate to={user.role === 'admin' ? '/admin' : '/agent'} replace />;
  }

  return <Outlet />;
}
