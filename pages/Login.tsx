import React, { useState } from 'react';
import { User } from '../types';
import { LogIn, Lock, Loader2, UserPlus, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { authAPI } from '../services/api';

interface LoginProps {
  onLogin: (user: User) => void;
}

const ORGANIZATIONS = ['Đông Anh', 'Phúc Thịnh', 'Thiên Lộc', 'Thư Lâm', 'Vĩnh Thanh'] as const;

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [activeModal, setActiveModal] = useState<'none' | 'login' | 'register'>('none');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [organization, setOrganization] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const resetForm = () => {
    setUsername('');
    setPassword('');
    setConfirmPassword('');
    setOrganization('');
    setError('');
    setSuccess('');
    setShowPassword(false);
    setShowConfirmPassword(false);
  };

  const openModal = (modal: 'login' | 'register') => {
    resetForm();
    setActiveModal(modal);
  };

  const closeModal = () => {
    resetForm();
    setActiveModal('none');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await authAPI.login(username, password);
      const params = new URLSearchParams(window.location.search);
      const returnUrl = params.get('return');

      if (returnUrl) {
        window.location.href = decodeURIComponent(returnUrl);
      } else {
        onLogin(data.data);
      }
    } catch (err: any) {
      setError(err.message || 'Tên đăng nhập hoặc mật khẩu không đúng');
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const data = await authAPI.register(username, password, confirmPassword, organization);
      setSuccess('Đăng ký thành công! Đang đăng nhập...');
      setTimeout(() => {
        onLogin(data.data);
      }, 1000);
    } catch (err: any) {
      setError(err.message || 'Đăng ký thất bại');
      setLoading(false);
    }
  };

  return (
    <div className="h-screen relative overflow-hidden">
      {/* Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: 'url(/login-bg-skyline.png)' }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/15 via-transparent to-black/40" />

      {/* Navigation Bar */}
      <nav className="relative z-10">
        <div className="mx-4 mt-4">
          <div className="bg-white/90 backdrop-blur-md rounded-2xl shadow-lg border border-blue-100 px-6 py-3 flex items-center justify-between">
            {/* Tên + tagline */}
            <div className="flex items-center gap-4 min-w-0 flex-1">
              <span className="text-lg sm:text-xl font-bold text-[#005992] tracking-tight shrink-0 whitespace-nowrap">
                VietinBank
              </span>
              <p className="text-xs sm:text-sm md:text-base font-semibold text-slate-700 leading-snug border-l border-slate-200 pl-3 sm:pl-4 min-w-0 max-w-[min(100%,14rem)] sm:max-w-none">
                Phần mềm quản lý dòng tiền
              </p>
            </div>

            {/* Buttons */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => openModal('register')}
                className="flex items-center gap-2 px-5 py-2.5 bg-white border-2 border-blue-600 text-blue-700 rounded-full text-sm font-bold hover:bg-blue-50 transition-all duration-200 shadow-sm"
              >
                <UserPlus size={16} />
                ĐĂNG KÝ
              </button>
              <button
                onClick={() => openModal('login')}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-full text-sm font-bold hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-md hover:shadow-lg"
              >
                <Lock size={16} />
                ĐĂNG NHẬP
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Text - positioned from bottom */}
      <div className="absolute z-10 bottom-[12%] left-4 right-4 sm:left-8 sm:right-8 md:right-auto">
        <div className="max-w-none">
          <h1 className="text-white font-bold mb-2 drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)] whitespace-nowrap tracking-tight text-[clamp(0.72rem,1.85vw+0.6rem,2.5rem)]">
            VietinBank Đông Anh Sẵn Sàng Phục Vụ
          </h1>
          <p className="text-white/90 text-base md:text-lg drop-shadow-md max-w-xl">
            Hệ thống quản lý dự án & giao dịch bồi thường GPMB
          </p>
        </div>
      </div>

      {/* Login Modal */}
      {activeModal === 'login' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="absolute inset-0 bg-black/10 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-md bg-white/20 backdrop-blur-lg rounded-3xl shadow-2xl border border-white/30 px-8 py-8 max-h-[92vh] overflow-y-auto animate-[fadeIn_0.2s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center mb-7">
              <h2 className="text-[22px] font-extrabold text-white leading-tight">
                Chào mừng quý khách đến với VietinBank <span className="text-[#0b5fa5]">GPMB</span>
              </h2>
            </div>

            <form onSubmit={handleLogin} className="space-y-6">
              <div>
                <label className="block text-xs font-semibold text-white/80 mb-2">
                  Tên đăng nhập
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-transparent border-b border-white/50 px-0 pb-2 text-sm font-medium text-white placeholder:text-white/40 focus:outline-none focus:border-blue-300 transition-colors"
                  placeholder="Tên đăng nhập"
                  required
                  disabled={loading}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-white/80 mb-2">
                  Mật khẩu
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-transparent border-b border-white/50 px-0 pb-2 text-sm font-medium text-white placeholder:text-white/40 focus:outline-none focus:border-blue-300 transition-colors pr-10"
                    placeholder="Mật khẩu"
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-0 top-0 h-full flex items-center justify-center text-white/70 hover:text-white"
                    aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="p-3 bg-rose-500/10 border border-rose-200/30 rounded-xl">
                  <p className="text-xs font-bold text-rose-100">{error}</p>
                </div>
              )}

              <div className="flex items-center justify-end pt-1">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-14 h-14 rounded-full bg-blue-700 hover:bg-blue-800 text-white flex items-center justify-center shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={20} />}
                </button>
              </div>

              <div className="flex items-center justify-between text-xs text-white/70 pt-1">
                <button
                  type="button"
                  className="font-semibold hover:underline text-white/80 hover:text-white"
                  onClick={() => setError('Tính năng "Quên tên đăng nhập / Mật khẩu" chưa được triển khai')}
                >
                  Quên tên đăng nhập / Mật khẩu
                </button>
                <button
                  type="button"
                  className="font-semibold hover:underline text-white/80 hover:text-white"
                  onClick={() => openModal('register')}
                >
                  Đăng ký
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Register Modal */}
      {activeModal === 'register' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="absolute inset-0 bg-black/10 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-md bg-white/20 backdrop-blur-lg rounded-3xl shadow-2xl border border-white/30 px-8 py-8 max-h-[92vh] overflow-y-auto animate-[fadeIn_0.2s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center mb-7">
              <h2 className="text-[22px] font-extrabold text-white leading-tight">
                Chào mừng quý khách đến với VietinBank <span className="text-[#0b5fa5]">GPMB</span>
              </h2>
              <p className="text-xs font-semibold text-white/80 mt-2">
                Đăng ký tài khoản mới
              </p>
            </div>

            <form onSubmit={handleRegister} className="space-y-6">
              <div>
                <label className="block text-xs font-semibold text-white/80 mb-2">
                  Tên đăng nhập
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-transparent border-b border-white/50 px-0 pb-2 text-sm font-medium text-white placeholder:text-white/40 focus:outline-none focus:border-emerald-300 transition-colors"
                  placeholder="Tên đăng nhập"
                  required
                  disabled={loading}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-white/80 mb-2">
                  Tổ chức
                </label>
                <select
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  required
                  disabled={loading}
                  className="login-org-select w-full bg-transparent border-b border-white/50 px-0 pb-2 text-sm font-medium text-white placeholder:text-white/40 focus:outline-none focus:border-emerald-300 transition-colors appearance-none"
                >
                  <option value="" className="text-black bg-white">
                    -- Chọn tổ chức --
                  </option>
                  {ORGANIZATIONS.map((org) => (
                    <option key={org} value={org} className="text-black bg-white">
                      {org}
                    </option>
                  ))}
                </select>
                <style>
                  {`
                    .login-org-select option {
                      color: #111827 !important;
                      background: #ffffff !important;
                    }
                  `}
                </style>
              </div>

              <div>
                <label className="block text-xs font-semibold text-white/80 mb-2">
                  Mật khẩu
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-transparent border-b border-white/50 px-0 pb-2 text-sm font-medium text-white placeholder:text-white/40 focus:outline-none focus:border-emerald-300 transition-colors pr-10"
                    placeholder="Ít nhất 6 ký tự"
                    required
                    disabled={loading}
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-0 top-0 h-full flex items-center justify-center text-white/70 hover:text-white"
                    aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-white/80 mb-2">
                  Xác nhận mật khẩu
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full bg-transparent border-b border-white/50 px-0 pb-2 text-sm font-medium text-white placeholder:text-white/40 focus:outline-none focus:border-emerald-300 transition-colors pr-10"
                    placeholder="Nhập lại mật khẩu"
                    required
                    disabled={loading}
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-0 top-0 h-full flex items-center justify-center text-white/70 hover:text-white"
                    aria-label={showConfirmPassword ? 'Ẩn mật khẩu xác nhận' : 'Hiện mật khẩu xác nhận'}
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="p-3 bg-rose-500/10 border border-rose-200/30 rounded-xl">
                  <p className="text-xs font-bold text-rose-100">{error}</p>
                </div>
              )}

              {success && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-200/30 rounded-xl">
                  <p className="text-xs font-bold text-emerald-100">{success}</p>
                </div>
              )}

              <div className="flex items-center justify-end pt-1">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={20} />}
                </button>
              </div>

              <div className="flex items-center justify-between text-xs text-white/70 pt-1">
                <button
                  type="button"
                  className="font-semibold hover:underline text-white/80 hover:text-white"
                  onClick={() => openModal('login')}
                >
                  Đăng nhập
                </button>
                <span className="font-semibold text-slate-500">
                  Vietinbank GPMB
                </span>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.95) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
};
