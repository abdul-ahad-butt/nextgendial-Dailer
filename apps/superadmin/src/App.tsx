import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Dashboard } from './pages/Dashboard';
import { AdminManagement } from './pages/AdminManagement';
import { NumberInventory } from './pages/NumberInventory';
import { CreditAuditLogs } from './pages/CreditAuditLogs';
import { Login } from './pages/Login';

const ProtectedLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const token = localStorage.getItem('super_admin_token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">{children}</main>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedLayout>
              <Dashboard />
            </ProtectedLayout>
          }
        />
        <Route
          path="/admins"
          element={
            <ProtectedLayout>
              <AdminManagement />
            </ProtectedLayout>
          }
        />
        <Route
          path="/numbers"
          element={
            <ProtectedLayout>
              <NumberInventory />
            </ProtectedLayout>
          }
        />
        <Route
          path="/ledger"
          element={
            <ProtectedLayout>
              <CreditAuditLogs />
            </ProtectedLayout>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
