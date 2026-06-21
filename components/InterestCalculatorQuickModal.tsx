import React from 'react';
import { X, Calculator } from 'lucide-react';
import { GlassCard } from './GlassCard';
import { InterestCalculator } from '../pages/InterestCalculator';
import { Transaction, Project, User } from '../types';

type Props = {
  open: boolean;
  onClose: () => void;
  currentUser: User;
  transactions: Transaction[];
  projects: Project[];
  interestRate: number;
};

export const InterestCalculatorQuickModal: React.FC<Props> = ({
  open,
  onClose,
  currentUser,
  transactions,
  projects,
  interestRate
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Calculator size={18} className="text-[#0b5fa5]" />
            <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-widest">Tính lãi dự kiến</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-200 transition-colors text-slate-500 hover:text-slate-700"
            aria-label="Đóng"
            title="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[78vh] overflow-y-auto">
          <div className="p-5">
            <GlassCard className="border-slate-200 shadow-sm">
              <InterestCalculator
                transactions={transactions}
                projects={projects}
                interestRate={interestRate}
                currentUser={currentUser}
              />
            </GlassCard>
          </div>
        </div>
      </div>
    </div>
  );
};

