import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { BASE } from '../lib/api';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login, user, isLoading } = useAuth();
  const navigate = useNavigate();

  // Redirect if already logged in
  React.useEffect(() => {
    if (!isLoading && user) {
      navigate(user.role === 'admin' ? '/admin' : '/agent', { replace: true });
    }
  }, [user, isLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        console.error('Login Error Detail:', data);
        throw new Error(data.error || 'Login failed');
      }

      login(data.token);
      
      // Explicit role-based redirection
      const userRole = data.role || (data.agent && data.agent.role) || 'agent';
      if (userRole === 'admin') {
        navigate('/admin');
      } else {
        navigate('/agent');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon" aria-hidden="true">📞</div>
          <h1 className="login-title">NextGenDial</h1>
          <p className="login-subtitle">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="form-group">
            <label className="form-label" htmlFor="username">Username</label>
            <input
              id="username"
              className={`form-control ${error ? 'is-invalid' : ''}`}
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (error) setError(null);
              }}
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input
              id="password"
              className={`form-control ${error ? 'is-invalid' : ''}`}
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              required
            />
          </div>
          
          {error && <div className="form-error" style={{ textAlign: 'center', marginTop: -4, marginBottom: 8 }}>{error}</div>}

          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', marginTop: 8 }}>
            {loading ? <span className="spinner" /> : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
