import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';

import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { AdminDashboard } from './pages/AdminDashboard';
import { AgentDashboard } from './pages/AgentDashboard';

// Root redirect handler
function RootRedirect() {
  const { user, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <span className="spinner" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'admin' ? '/admin' : '/agent'} replace />;
}

// Minimal wrapper for the AgentDashboard to pass required props 
// (assuming we pass the agent object with id, name to it, though we will likely fetch it securely later)
function AgentDashboardWrapper() {
  const { user, logout } = useAuth();
  
  if (!user) return null;

  // We construct a mock Agent object for now to satisfy the existing AgentDashboard props
  // since the real agent data will come from the backend based on the JWT
  const agent = {
    id: user.sub,
    username: 'Agent',
    email: '',
    status: 'offline'
  } as any;

  return <AgentDashboard agent={agent} onLogout={logout} />;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          
          <Route element={<ProtectedRoute allowedRole="admin" />}>
            <Route path="/admin/*" element={<AdminDashboard />} />
          </Route>
          
          <Route element={<ProtectedRoute allowedRole="agent" />}>
            <Route path="/agent/*" element={<AgentDashboardWrapper />} />
          </Route>

          <Route path="/" element={<RootRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

