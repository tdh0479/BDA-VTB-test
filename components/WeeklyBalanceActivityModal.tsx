import React, { useEffect, useMemo, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { HoatDongActivityIcon } from './HoatDongActivityIcon';
import {
  BankTransaction,
  BankTransactionType,
  BankAccount,
  Project,
  Transaction,
  TransactionStatus,
  User
} from '../types';
import {
  calculateInterest,
  calculateInterestWithRateChange,
  formatCurrency,
  formatDate,
  getVNNow,
  roundTo2,
  toVNTime
} from '../utils/helpers';

type Props = {
  open: boolean;
  onClose: () => void;
  currentUser: User;
  transactions: Transaction[];
  projects: Project[];
  bankAccount: BankAccount;
  bankTransactions: BankTransaction[];
  interestRate: number;
  interestRateChangeDate?: string | null;
  interestRateBefore?: number | null;
  interestRateAfter?: number | null;
};

export const WeeklyBalanceActivityModal: React.FC<Props> = ({
  open,
  onClose,
  currentUser: _currentUser,
  transactions,
  projects,
  bankAccount,
  bankTransactions,
  interestRate,
  interestRateChangeDate,
  interestRateBefore,
  interestRateAfter
}) => {
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  const [liveNow, setLiveNow] = useState(getVNNow());

  useEffect(() => {
    if (!open) return;
    setPage(1);
    setLiveNow(getVNNow());

    const timer = window.setInterval(() => {
      setLiveNow(getVNNow());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [open]);

  const getTxAuditTimestamp = (tx: BankTransaction) => {
    // Prefer mongoose timestamps to avoid "date-only => 00:00:00" display issues.
    const anyTx = tx as any;
    return anyTx.updatedAt || anyTx.createdAt || tx.date;
  };

  const weeklyActivityAll = useMemo(() => {
    const list = bankTransactions || [];
    if (!list.length) return [];

    const now = getVNNow();
    const from = new Date(now);
    from.setDate(from.getDate() - 7);

    return list
      .map((tx) => ({ tx, stamp: toVNTime(getTxAuditTimestamp(tx)) }))
      .filter(({ stamp }) => stamp.getTime() >= from.getTime())
      .sort((a, b) => b.stamp.getTime() - a.stamp.getTime())
      .map(({ tx }) => tx);
  }, [bankTransactions]);

  const totalPages = Math.max(1, Math.ceil(weeklyActivityAll.length / PAGE_SIZE));

  const weeklyActivityPage = useMemo(() => {
    const safePage = Math.max(1, Math.min(page, totalPages));
    const start = (safePage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    return weeklyActivityAll.slice(start, end);
  }, [weeklyActivityAll, page, totalPages]);

  const pendingData = useMemo(() => {
    if (!transactions || transactions.length === 0) {
      return { principal: 0, interest: 0, supplementary: 0, locked: 0 };
    }

    let principal = 0;
    let tempInterest = 0;
    let lockedInterest = 0;
    let supplementaryAmount = 0;

    const hasRateChange = !!(
      interestRateChangeDate &&
      interestRateBefore !== null &&
      interestRateAfter !== null
    );

    transactions.forEach((t) => {
      const project = projects.find((p) => p.id === t.projectId);
      const baseDate = t.effectiveInterestDate || project?.interestStartDate;
      const principalBase = (t as any).principalForInterest ?? t.compensation.totalApproved;

      if (t.status === TransactionStatus.DISBURSED && t.disbursementDate) {
        const supplementary = t.supplementaryAmount || 0;
        let calculatedInterest = 0;

        if (hasRateChange) {
          const interestResult = calculateInterestWithRateChange(
            t.compensation.totalApproved,
            baseDate,
            new Date(t.disbursementDate),
            interestRateChangeDate!,
            interestRateBefore!,
            interestRateAfter!
          );
          calculatedInterest = interestResult.totalInterest;
        } else {
          calculatedInterest = calculateInterest(
            t.compensation.totalApproved,
            interestRate,
            baseDate,
            new Date(t.disbursementDate)
          );
        }

        const computedTotal = roundTo2(t.compensation.totalApproved + calculatedInterest + supplementary);
        const storedTotal = Number((t as any).disbursedTotal);

        if (isFinite(storedTotal) && storedTotal > 0 && Math.abs(roundTo2(storedTotal) - computedTotal) < 0.01) {
          const extractedInterest = roundTo2(storedTotal) - t.compensation.totalApproved - supplementary;
          lockedInterest += extractedInterest;
        } else {
          lockedInterest += calculatedInterest;
        }
      } else if (t.status !== TransactionStatus.DISBURSED) {
        principal += principalBase;

        let tInterest = 0;
        if (hasRateChange) {
          const interestResult = calculateInterestWithRateChange(
            principalBase,
            baseDate,
            new Date(),
            interestRateChangeDate!,
            interestRateBefore!,
            interestRateAfter!
          );
          tInterest = interestResult.totalInterest;
        } else {
          tInterest = calculateInterest(principalBase, interestRate, baseDate, new Date());
        }

        tempInterest += tInterest;
        supplementaryAmount += t.supplementaryAmount || 0;
      }
    });

    return {
      principal,
      interest: tempInterest,
      locked: lockedInterest,
      supplementary: supplementaryAmount
    };
  }, [transactions, projects, interestRate, interestRateChangeDate, interestRateBefore, interestRateAfter, bankAccount.currentBalance]);

  if (!open) return null;

  const displayBalance = pendingData.principal + pendingData.interest + pendingData.supplementary;

  const formatDateTimeVN = (dateInput: any) => {
    const d = toVNTime(dateInput);
    if (isNaN(d.getTime())) return dateInput;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
  };

  const formatTxType = (type: BankTransactionType) => {
    if (type === BankTransactionType.DEPOSIT) return 'NẠP TIỀN';
    if (type === BankTransactionType.WITHDRAW) return 'RÚT TIỀN';
    return 'ĐIỀU CHỈNH';
  };

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
        <div className="p-6 border-b border-slate-200 bg-gradient-to-r from-slate-50/90 to-blue-50/40 flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm border border-slate-200/80">
                <HoatDongActivityIcon size={28} />
              </span>
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-widest">
                  Hoạt động 7 ngày
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5 font-medium">Biến động dòng tiền ngân hàng</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="text-slate-600">
                Live audit: <span className="font-bold text-slate-900">{formatDateTimeVN(liveNow.toISOString())}</span>
              </span>
              <span className="text-slate-500">
                Tổng: <span className="font-bold text-slate-900">{weeklyActivityAll.length}</span> giao dịch
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors"
            aria-label="Đóng"
          >
            <X size={18} className="text-slate-600" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
              <p className="text-[10px] font-bold text-blue-700 uppercase tracking-widest">Tiền chưa giải ngân</p>
              <p className="text-2xl font-extrabold text-slate-900 mt-1">
                {formatCurrency(roundTo2(displayBalance))}
              </p>
              <p className="text-[10px] text-blue-700/90 mt-1">Số dư chưa giải ngân</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
              <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest">Lãi tạm tính</p>
              <p className="text-2xl font-extrabold text-emerald-700 mt-1">
                {formatCurrency(roundTo2(pendingData.interest))}
              </p>
              {pendingData.locked > 0 ? (
                <p className="text-[10px] text-emerald-800/90 mt-1">
                  Đã chốt: {formatCurrency(roundTo2(pendingData.locked))}
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-extrabold text-slate-900">Danh sách giao dịch 7 ngày</p>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-[10px] font-bold text-black uppercase tracking-wide whitespace-nowrap">Thời gian (VN)</th>
                    <th className="px-4 py-3 text-[10px] font-bold text-black uppercase tracking-wide whitespace-nowrap">Loại</th>
                    <th className="px-4 py-3 text-[10px] font-bold text-black uppercase tracking-wide">Nội dung</th>
                    <th className="px-4 py-3 text-[10px] font-bold text-black uppercase tracking-wide text-right whitespace-nowrap">Số tiền</th>
                    <th className="px-4 py-3 text-[10px] font-bold text-black uppercase tracking-wide text-right whitespace-nowrap">Số dư</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {weeklyActivityAll.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-slate-500 text-xs font-semibold">
                        Chưa có hoạt động trong 7 ngày gần đây
                      </td>
                    </tr>
                  ) : (
                    weeklyActivityPage.map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 text-xs font-bold text-slate-700 whitespace-nowrap">
                          {formatDateTimeVN(getTxAuditTimestamp(tx))}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            tx.type === BankTransactionType.DEPOSIT
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : tx.type === BankTransactionType.WITHDRAW
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}>
                            {formatTxType(tx.type)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          <div className="min-w-[260px] truncate">{tx.note || '-'}</div>
                          <div className="text-[10px] text-slate-500 mt-1">{formatDate(getTxAuditTimestamp(tx) as any)}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-extrabold text-xs whitespace-nowrap">
                          <span className={tx.amount >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                            {tx.amount >= 0 ? '+' : ''}
                            {formatCurrency(tx.amount)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-extrabold text-xs whitespace-nowrap text-slate-900">
                          {formatCurrency(tx.runningBalance)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {weeklyActivityAll.length > 0 && totalPages > 1 && (
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 text-sm font-medium border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 flex items-center gap-2"
                >
                  <ChevronLeft size={16} /> Trang trước
                </button>
                <span className="text-sm text-slate-500 min-w-[120px] text-center">
                  Trang <span className="font-bold text-slate-700">{Math.max(1, Math.min(page, totalPages))}</span> / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 text-sm font-medium border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 flex items-center gap-2"
                >
                  Trang sau <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

