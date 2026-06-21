import React from 'react';
import { User } from '../types';
import { LayoutDashboard, FolderKanban, ArrowLeftRight, ShieldCheck, LogOut } from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: User;
  onLogout?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, currentUser, onLogout }) => {
  const menuItems = [
    { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
    { id: 'projects', label: 'Dự án', icon: FolderKanban },
    { id: 'transactions', label: 'Giao dịch', icon: ArrowLeftRight },
    { id: 'admin', label: 'Cài đặt', icon: ShieldCheck },
  ];

  const availableItems = menuItems.filter(item => {
    const isElevated = currentUser.role === 'Admin' || currentUser.role === 'SuperAdmin';
    if (item.id === 'admin') return isElevated;
    if (isElevated) return true;
    return currentUser.permissions.includes(item.id);
  });

  return (
    <header
      className="fixed top-0 left-0 right-0 h-16 flex items-center justify-between px-6 z-50 shadow-lg border-b border-white/10 opacity-[0.86] hover:opacity-100 transition-opacity duration-300"
      style={{
        background: 'linear-gradient(90deg, #005992 0%, #004070 30%, #5c2a4a 70%, #D71049 100%)',
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-4 w-[250px]">
        <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-sm border border-white/20 shadow-inner">
          <span className="text-white font-black text-xl">V</span>
        </div>
        <div className="flex flex-col">
          <span className="text-white font-bold text-lg leading-none tracking-tight mb-1">VietinBank</span>
          <span className="text-white/80 text-[11px] font-semibold leading-none tracking-wide">Chi Nhánh Đông Anh</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 flex justify-center items-center gap-2 px-4">
        {availableItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300
                ${isActive
                  ? 'bg-white/30 text-white backdrop-blur-md border border-white/40 font-bold scale-105'
                  : 'text-white/70 hover:bg-white/10 hover:text-white border border-transparent hover:scale-105'}
              `}
            >
              <Icon size={18} strokeWidth={isActive ? 3 : 2} className={isActive ? "text-white" : ""} />
              <span className={isActive ? "tracking-wide" : ""}>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* User & Logout */}
      <div className="flex items-center gap-4 w-[250px] justify-end">
        <div className="flex items-center gap-3 bg-white/5 hover:bg-white/10 transition-colors px-3 py-1.5 rounded-xl backdrop-blur-sm border border-white/10 cursor-pointer" title={currentUser.name}>
          <div className="flex flex-col text-right">
            <span className="text-white text-[13px] font-semibold leading-tight">{currentUser.name}</span>
            <span className="text-blue-200 text-[10px] font-medium leading-tight">{currentUser.role}</span>
          </div>
          <img src={currentUser.avatar} alt="User" className="w-9 h-9 rounded-full object-cover border-2 border-white/20 shadow-sm" />
        </div>
        <div className="w-px h-8 bg-white/20"></div>
        <button
          onClick={onLogout}
          className="p-2.5 text-white/70 hover:text-white hover:bg-red-500/80 rounded-xl transition-all duration-300 shadow-sm border border-transparent hover:border-red-400/50"
          title="Đăng xuất"
        >
          <LogOut size={20} strokeWidth={2.5} />
        </button>
      </div>
    </header>
  );
};
