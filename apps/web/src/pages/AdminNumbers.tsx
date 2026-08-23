import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function AdminNumbers() {
  const [numbers, setNumbers] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [nums, ags] = await Promise.all([
        api.admin.getNumbers(),
        api.admin.getAgents(),
      ]);
      setNumbers(nums);
      setAgents(ags);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAssign = async (phoneId: string, userId: string) => {
    try {
      await api.admin.assignNumber(phoneId, userId === 'unassign' ? null : userId);
      await fetchData(); // refresh list
    } catch (err: any) {
      alert(`Error assigning number: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <span className="spinner" style={{ marginRight: 8 }} /> Loading numbers...
      </div>
    );
  }

  return (
    <div style={{ padding: 32, maxWidth: 1000, margin: '0 auto' }}>
      <h2 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>Phone Numbers Inventory</h2>
      
      {error && (
        <div className="connection-banner connection-banner--error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface-sunken)', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>Phone Number</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>Friendly Name</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>Status</th>
              <th style={{ padding: '12px 16px', fontWeight: 500 }}>Assigned Agent</th>
            </tr>
          </thead>
          <tbody>
            {numbers.map((num) => (
              <tr key={num.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 14 }}>{num.phone_number}</td>
                <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>{num.friendly_name || '-'}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span className={`status-badge status-badge--${num.status}`}>
                    {num.status}
                  </span>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <select
                    value={num.assigned_to_user_id || 'unassign'}
                    onChange={(e) => handleAssign(num.id, e.target.value)}
                    className="input"
                    style={{ padding: '6px 12px', fontSize: 13, height: 'auto', width: '200px' }}
                  >
                    <option value="unassign">-- Unassigned --</option>
                    {agents.map((ag) => (
                      <option key={ag.id} value={ag.id}>
                        {ag.username}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {numbers.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
            No phone numbers found in inventory.
          </div>
        )}
      </div>
    </div>
  );
}
