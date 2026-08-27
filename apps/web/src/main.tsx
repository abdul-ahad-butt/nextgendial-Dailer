import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';

import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { AdminDashboard } from './pages/AdminDashboard';
import { AdminLeadSheets } from './pages/AdminLeadSheets';
import { AdminLeads } from './pages/AdminLeads';
import { AdminRecordings } from './pages/AdminRecordings';
import { AdminAgentStatus } from './pages/AdminAgentStatus';
import { AgentDashboard } from './pages/AgentDashboard';
import { api } from './lib/api';
import { useState, useEffect } from 'react';

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
// (fetching actual agent details based on JWT sub)
function AgentDashboardWrapper() {
  const { user, logout } = useAuth();
  const [agentDetails, setAgentDetails] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    if (user?.sub) {
      api.agents.get(user.sub)
        .then(agentData => setAgentDetails(agentData))
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [user?.sub]);

  if (!user) return null;
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <span className="spinner" />
      </div>
    );
  }

  const agent = {
    id: user.sub,
    username: agentDetails?.username || 'Agent',
    email: '',
    status: agentDetails?.status || 'offline'
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
            <Route path="/admin/recordings" element={<AdminRecordings />} />
            <Route path="/admin/leadsheets" element={<AdminLeadSheets />} />
            <Route path="/admin/leads" element={<AdminLeads />} />
            <Route path="/admin/agent-status" element={<AdminAgentStatus />} />
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

