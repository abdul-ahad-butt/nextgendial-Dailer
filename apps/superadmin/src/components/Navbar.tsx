import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

export const Navbar: React.FC = () => {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('super_admin_token');
    navigate('/login');
  };

  const navItems = [
    { to: '/', label: 'Executive Dashboard', icon: '⚡' },
    { to: '/admins', label: 'Tenant Organizations', icon: '🏢' },
    { to: '/numbers', label: 'Telnyx Lines Inventory', icon: '📱' },
    { to: '/ledger', label: 'Credit Audit Ledger', icon: '📋' },
  ];

  return (
    <header className="sticky top-0 z-40 bg-[#0A0E17]/90 backdrop-blur-md border-b border-slate-800/80 px-6 py-3.5 flex items-center justify-between">
      {/* Brand */}
      <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-black text-base shadow-lg shadow-emerald-500/25">
          N
        </div>
        <div>
          <div className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
            <span>NextGenDial</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold uppercase tracking-wider">
              SUPER ADMIN
            </span>
          </div>
          <div className="text-[11px] text-slate-400">Master Account & Telephony Controller</div>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex items-center gap-1.5 bg-slate-900/80 p-1 rounded-2xl border border-slate-800/90 text-xs font-medium">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3.5 py-1.5 rounded-xl transition-all ${
                isActive
                  ? 'bg-emerald-500 text-slate-950 font-semibold shadow-md shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`
            }
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* User / Sign Out */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-slate-300 font-mono font-medium">Master Ledger Online</span>
        </div>
        <button
          onClick={handleLogout}
          className="btn-secondary text-xs"
        >
          Sign Out
        </button>
      </div>
    </header>
  );
};
