import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { CustomSelect } from '../components/common/CustomSelect';
import { GlassCard } from '../components/common/GlassCard';
import { formatE164 } from '../utils/formatters';

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
      await fetchData();
    } catch (err: any) {
      alert(`Error assigning number: ${err.message}`);
    }
  };

  const agentOptions = [
    { value: 'unassign', label: '— Unassigned —' },
    ...(agents || []).map((ag) => ({ value: ag?.id || '', label: ag?.username || ag?.name || 'Agent' })),
  ];

  if (loading) {
    return (
      <div className="py-16 text-center text-xs text-slate-500">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block mr-2" />
        Loading phone numbers...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white">Phone Numbers Inventory</h2>
        <p className="text-xs text-slate-400">
          Phone lines allocated to your organization by the Super Admin. Assign lines to agents for outbound dialing.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
          {error}
        </div>
      )}

      <GlassCard title="Allocated DID Lines" subtitle={`${(numbers || []).length} numbers available`}>
        {(numbers || []).length === 0 ? (
          <div className="py-12 text-center text-slate-500">
            <div className="w-12 h-12 rounded-2xl bg-slate-800/60 flex items-center justify-center text-xl mx-auto mb-2">
              📱
            </div>
            <div className="text-sm font-semibold text-slate-300">No Phone Numbers Assigned</div>
            <div className="text-xs text-slate-500 mt-1">
              Contact your Super Admin to allocate 1-2 phone lines to your organization.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">Phone Number</th>
                  <th className="py-3 px-4">Friendly Name</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4" style={{ minWidth: 220 }}>Assigned Agent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {(numbers || []).map((num) => (
                  <tr key={num?.id || num?.phone_number || Math.random()} className="hover:bg-slate-800/20 transition-colors">
                    <td className="py-3 px-4 font-mono font-medium text-slate-200">
                      {formatE164(num?.phone_number || '')}
                    </td>
                    <td className="py-3 px-4 text-slate-400">
                      {num?.friendly_name || num?.name || 'Primary Line'}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        {num?.status || 'Active'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <CustomSelect
                        value={num?.assigned_to_user_id || 'unassign'}
                        onChange={(val) => handleAssign(num?.id || num?.phone_number, val)}
                        options={agentOptions}
                        placeholder="Select agent..."
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
