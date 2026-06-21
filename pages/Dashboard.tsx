
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Transaction, TransactionStatus, Project, User, BankAccount } from '../types';
import { formatCurrency, calculateInterest, calculateInterestWithRateChange, formatDate, roundTo2, exportTransactionsToExcel } from '../utils/helpers';
import {
  ComposedChart,
  Line,
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Area,
  AreaChart,
  LabelList
} from 'recharts';

interface DashboardProps {
  transactions: Transaction[];
  projects: Project[];
  users?: User[];
  interestRate: number;
  interestRateChangeDate?: string | null;
  interestRateBefore?: number | null;
  interestRateAfter?: number | null;
  bankAccount: BankAccount;
  setActiveTab: (tab: string) => void;
  onOpenBalanceModal: () => void;
  currentUser: User;
}

export const Dashboard: React.FC<DashboardProps> = ({ 
  transactions, 
  projects, 
  users = [], 
  interestRate, 
  interestRateChangeDate,
  interestRateBefore,
  interestRateAfter,
  bankAccount, 
  setActiveTab, 
  onOpenBalanceModal,
  currentUser 
}) => {
  const [selectedProjectIds, setSelectedProjectIds] = React.useState<string[]>([]);
  const [inputStartDate, setInputStartDate] = useState<string>('');
  const [inputEndDate, setInputEndDate] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [pendingSearch, setPendingSearch] = useState('');
  const [paymentListPage, setPaymentListPage] = useState(0);
  const formattedStart = startDate ? formatDate(startDate) : '---';
  const formattedEnd = endDate ? formatDate(endDate) : '---';

  const inputStartRef = useRef(inputStartDate);
  const inputEndRef = useRef(inputEndDate);
  inputStartRef.current = inputStartDate;
  inputEndRef.current = inputEndDate;

  useEffect(() => {
    const timer = setTimeout(() => {
      setStartDate(inputStartRef.current);
      setEndDate(inputEndRef.current);
    }, 400);
    return () => clearTimeout(timer);
  }, [inputStartDate, inputEndDate]);

  const resolveProject = React.useCallback((t: Transaction) => {
    const pIdStr = (t.projectId && (t.projectId as any)._id) ? (t.projectId as any)._id.toString() : t.projectId?.toString();
    return projects.find(p => (p.id === pIdStr || (p as any)._id === pIdStr));
  }, [projects]);

  const calculateInterestSmart = React.useCallback((
    principal: number,
    baseDate: string | undefined,
    endDate: Date
  ): number => {
    const hasRateChange = interestRateChangeDate && interestRateBefore !== null && interestRateAfter !== null;
    if (hasRateChange) {
      const interestResult = calculateInterestWithRateChange(
        principal,
        baseDate,
        endDate,
        interestRateChangeDate,
        interestRateBefore,
        interestRateAfter
      );
      return interestResult.totalInterest;
    } else {
      return calculateInterest(principal, interestRate, baseDate, endDate);
    }
  }, [interestRate, interestRateChangeDate, interestRateBefore, interestRateAfter]);

  const getRelevantDate = React.useCallback((t: Transaction, projectParam?: Project) => {
    const project = projectParam ?? resolveProject(t);
    const baseDate = t.effectiveInterestDate || project?.interestStartDate || (project as any)?.startDate;
    return baseDate;
  }, [resolveProject]);

  const isDateWithinRange = React.useCallback((dateStr?: string) => {
    if (!dateStr) return false;
    const value = new Date(dateStr);
    if (isNaN(value.getTime())) return false;
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    if (start && value < start) return false;
    if (end) {
      const endOfDay = new Date(end);
      endOfDay.setHours(23, 59, 59, 999);
      if (value > endOfDay) return false;
    }
    return true;
  }, [startDate, endDate]);

  const isTransactionInDateRange = React.useCallback((t: Transaction, project?: Project) => {
    if (!startDate && !endDate) return true;
    const interestDate = t.effectiveInterestDate || project?.interestStartDate || (project as any)?.startDate;
    if (isDateWithinRange(interestDate)) return true;
    if (t.disbursementDate && isDateWithinRange(t.disbursementDate)) return true;
    return false;
  }, [startDate, endDate, isDateWithinRange]);

  const getEffectiveStatus = React.useCallback((t: Transaction): TransactionStatus => {
    if (!endDate) return t.status;
    if (t.disbursementDate) {
      const disbursementDateTime = new Date(t.disbursementDate).getTime();
      const filterEndTime = new Date(endDate).setHours(23, 59, 59, 999);
      if (disbursementDateTime > filterEndTime) {
        return TransactionStatus.PENDING;
      }
    }
    return t.status;
  }, [endDate]);

  const getEffectiveCalculationDate = React.useCallback((t: Transaction): Date => {
    if (!endDate) {
      if (t.status === TransactionStatus.DISBURSED && t.disbursementDate) {
        return new Date(t.disbursementDate);
      }
      return new Date();
    }
    const effectiveStatus = getEffectiveStatus(t);
    if (effectiveStatus === TransactionStatus.DISBURSED && t.disbursementDate) {
      return new Date(t.disbursementDate);
    } else {
      const filterEnd = new Date(endDate);
      filterEnd.setHours(23, 59, 59, 999);
      return filterEnd;
    }
  }, [endDate, getEffectiveStatus]);

  // --- Data Aggregation Logic ---

  const filteredProjects = useMemo(() => {
    if (selectedProjectIds.length === 0) return projects;
    return projects.filter(p => selectedProjectIds.includes(p.id));
  }, [projects, selectedProjectIds]);

  const dateFilteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      const project = resolveProject(t);
      return isTransactionInDateRange(t, project);
    });
  }, [transactions, resolveProject, isTransactionInDateRange]);

  const filteredTransactions = useMemo(() => {
    let base = dateFilteredTransactions;
    if (selectedProjectIds.length > 0) {
      base = base.filter(t => {
        const pIdStr = (t.projectId && (t.projectId as any)._id) ? (t.projectId as any)._id.toString() : t.projectId?.toString();
        return selectedProjectIds.includes(pIdStr);
      });
    }
    return base;
  }, [dateFilteredTransactions, selectedProjectIds]);

  const isDateFiltered = !!(startDate || endDate);

  const statsTotalProjectValueUploaded = useMemo(() => {
    return filteredProjects.reduce((acc, project) => {
      const projectTrans = filteredTransactions.filter(t => {
        const pIdStr = (t.projectId && (t.projectId as any)._id) ? (t.projectId as any)._id.toString() : t.projectId?.toString();
        return pIdStr === project.id || pIdStr === (project as any)._id;
      });
      const actualTotal = projectTrans.reduce((sum, t) => {
        const supplementary = t.supplementaryAmount || 0;
        const effStatus = getEffectiveStatus(t);
        const baseDate = t.effectiveInterestDate || project.interestStartDate || (project as any).startDate;
        const principalBase = (t as any).principalForInterest ?? t.compensation.totalApproved;
        const calcDate = getEffectiveCalculationDate(t);
        const interest = calculateInterestSmart(principalBase, baseDate, calcDate);
        return sum + principalBase + interest + supplementary;
      }, 0);
      return acc + (actualTotal > 0 ? actualTotal : (isDateFiltered ? 0 : project.totalBudget));
    }, 0);
  }, [filteredProjects, filteredTransactions, calculateInterestSmart, getEffectiveStatus, getEffectiveCalculationDate, isDateFiltered]);

  const computedStats = useMemo(() => {
    const disbursedTrans = filteredTransactions.filter(t => getEffectiveStatus(t) === TransactionStatus.DISBURSED);

    const disbursedAmountFromFull = disbursedTrans.reduce((acc, t) => {
      const project = resolveProject(t);
      const baseDate = t.effectiveInterestDate || project?.interestStartDate || (project as any)?.startDate;
      const principalBase = (t as any).principalForInterest ?? t.compensation.totalApproved;
      const calcDate = getEffectiveCalculationDate(t);
      const interest = calculateInterestSmart(principalBase, baseDate, calcDate);
      const supplementary = t.supplementaryAmount || 0;
      return acc + principalBase + interest + supplementary;
    }, 0);

    const disbursedAmountFromPartial = filteredTransactions
      .filter(t => getEffectiveStatus(t) !== TransactionStatus.DISBURSED && (t as any).withdrawnAmount)
      .reduce((acc, t) => acc + ((t as any).withdrawnAmount || 0), 0);

    const disbursedAmount = roundTo2(disbursedAmountFromFull + disbursedAmountFromPartial);

    const pendingTrans = filteredTransactions.filter(t => getEffectiveStatus(t) !== TransactionStatus.DISBURSED);

    const pendingAmount = roundTo2(pendingTrans.reduce((acc, t) => {
      const project = resolveProject(t);
      const baseDate = t.effectiveInterestDate || project?.interestStartDate || (project as any)?.startDate;
      const principalBase = (t as any).principalForInterest ?? t.compensation.totalApproved;
      const calcDate = getEffectiveCalculationDate(t);
      const interest = calculateInterestSmart(principalBase, baseDate, calcDate);
      const supplementary = t.supplementaryAmount || 0;
      return acc + principalBase + interest + supplementary;
    }, 0));

    // Tiền chưa giải ngân chỉ theo phê duyệt (gốc + bổ sung), không cộng lãi
    const statsPendingByApprovalOnly = roundTo2(pendingTrans.reduce((acc, t) => {
      const principalBase = (t as any).principalForInterest ?? t.compensation.totalApproved;
      const supplementary = t.supplementaryAmount || 0;
      return acc + principalBase + supplementary;
    }, 0));

    let tempInt = 0;
    let lockedInt = 0;
    let intBefore = 0;
    let intAfter = 0;
    const rateChanged = interestRateChangeDate && interestRateBefore !== null && interestRateAfter !== null;

    filteredTransactions.forEach(t => {
      const project = resolveProject(t);
      const baseDate = t.effectiveInterestDate || project?.interestStartDate || (project as any)?.startDate;
      const principalBase = (t as any).principalForInterest ?? t.compensation.totalApproved;
      const effStatus = getEffectiveStatus(t);
      const calcDate = getEffectiveCalculationDate(t);
      const interest = calculateInterestSmart(principalBase, baseDate, calcDate);

      if (effStatus === TransactionStatus.DISBURSED) {
        lockedInt += interest;
      } else {
        tempInt += interest;
        if (rateChanged) {
          const result = calculateInterestWithRateChange(
            principalBase, baseDate, calcDate,
            interestRateChangeDate, interestRateBefore, interestRateAfter
          );
          intBefore += result.interestBefore;
          intAfter += result.interestAfter;
        }
      }
    });

    return {
      statsDisbursedTrans: disbursedTrans,
      statsDisbursedAmount: disbursedAmount,
      statsPendingCount: pendingTrans.length,
      statsPendingAmount: pendingAmount,
      statsPendingByApprovalOnly,
      statsTotalInterestRounded: roundTo2(tempInt),
      statsLockedInterestRounded: roundTo2(lockedInt),
      interestBeforeTotalRounded: roundTo2(intBefore),
      interestAfterTotalRounded: roundTo2(intAfter),
      displayBalance: pendingAmount,
      statsTotalProjectValue: disbursedAmount + pendingAmount,
      hasRateChange: rateChanged,
    };
  }, [filteredTransactions, getEffectiveStatus, getEffectiveCalculationDate, calculateInterestSmart,
      resolveProject, interestRateChangeDate, interestRateBefore, interestRateAfter]);

  const {
    statsDisbursedTrans, statsDisbursedAmount, statsPendingCount, statsPendingAmount, statsPendingByApprovalOnly,
    statsTotalInterestRounded, statsLockedInterestRounded,
    interestBeforeTotalRounded, interestAfterTotalRounded,
    displayBalance, statsTotalProjectValue, hasRateChange
  } = computedStats;

  const projectStats = useMemo(() => {
    return projects.map(project => {
      const projectTrans = dateFilteredTransactions.filter(t => {
        const pIdStr = (t.projectId && (t.projectId as any)._id) ? (t.projectId as any)._id.toString() : t.projectId?.toString();
        return pIdStr === project.id || (project as any)._id === pIdStr;
      });

      const pDisbursed = projectTrans
        .filter(t => getEffectiveStatus(t) === TransactionStatus.DISBURSED)
        .reduce((acc, t) => {
          const baseDate = t.effectiveInterestDate || project.interestStartDate;
          const principalBase = (t as any).principalForInterest ?? t.compensation.totalApproved;
          const calcDate = getEffectiveCalculationDate(t);
          const interest = calculateInterestSmart(principalBase, baseDate, calcDate);
          const supplementary = t.supplementaryAmount || 0;
          return acc + principalBase + interest + supplementary;
        }, 0);

      const pPending = projectTrans
        .filter(t => getEffectiveStatus(t) !== TransactionStatus.DISBURSED)
        .reduce((acc, t) => {
          const baseDate = t.effectiveInterestDate || project.interestStartDate;
          const principalBase = (t as any).principalForInterest ?? t.compensation.totalApproved;
          const calcDate = getEffectiveCalculationDate(t);
          const interest = calculateInterestSmart(principalBase, baseDate, calcDate);
          const supplementary = t.supplementaryAmount || 0;
          return acc + principalBase + interest + supplementary;
        }, 0);

      const pInterestRaw = projectTrans.reduce((acc, t) => {
        const baseDate = t.effectiveInterestDate || project.interestStartDate;
        const principalBase = (t as any).principalForInterest ?? t.compensation.totalApproved;
        const calcDate = getEffectiveCalculationDate(t);
        return acc + calculateInterestSmart(principalBase, baseDate, calcDate);
      }, 0);

      const pInterest = roundTo2(pInterestRaw);
      const completionRate = project.totalBudget > 0 ? (pDisbursed / project.totalBudget) * 100 : 0;

      return {
        ...project,
        disbursedAmount: pDisbursed,
        pendingAmount: pPending,
        interestAmount: pInterest,
        completionRate: parseFloat(completionRate.toFixed(1))
      };
    });
  }, [projects, dateFilteredTransactions, interestRate, getEffectiveStatus, getEffectiveCalculationDate, calculateInterestSmart]);

  const chartData = useMemo(() => {
    if (selectedProjectIds.length === 0) return projectStats;
    return projectStats.filter(p => selectedProjectIds.includes(p.id));
  }, [projectStats, selectedProjectIds]);

  const MAX_PROJECTS_CHART = 30;
  const chartDataDisplay = useMemo(() => chartData.slice(0, MAX_PROJECTS_CHART), [chartData]);
  const chartHeight = Math.min(800, 280 + chartDataDisplay.length * 20);

  const holdCount = useMemo(() => filteredTransactions.filter(t => getEffectiveStatus(t) === TransactionStatus.HOLD).length, [filteredTransactions, getEffectiveStatus]);

  const donutStatusData = useMemo(() => {
    const disbursedCount = filteredTransactions.filter(t => getEffectiveStatus(t) === TransactionStatus.DISBURSED).length;
    const notDisbursedCount = filteredTransactions.filter(t => getEffectiveStatus(t) !== TransactionStatus.DISBURSED).length;
    return [
      { name: 'Đã giải ngân', value: statsDisbursedAmount, count: disbursedCount, color: '#005992' },
      { name: 'Chưa giải ngân', value: statsPendingAmount, count: notDisbursedCount, color: '#94a3b8' },
    ].filter(d => d.count > 0);
  }, [filteredTransactions, getEffectiveStatus, statsDisbursedAmount, statsPendingAmount]);

  const disbursementTrendData = useMemo(() => {
    const year = endDate
      ? new Date(endDate).getFullYear()
      : startDate
        ? new Date(startDate).getFullYear()
        : new Date().getFullYear();
    const months = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'];
    return months.map((label, i) => {
      const month = i + 1;
      const disbursedInMonth = statsDisbursedTrans.filter(t => {
        if (!t.disbursementDate) return false;
        const d = new Date(t.disbursementDate);
        return d.getMonth() + 1 === month && d.getFullYear() === year;
      }).reduce((acc, t) => {
        const proj = resolveProject(t);
        const base = (t as any).principalForInterest ?? t.compensation?.totalApproved ?? 0;
        const calcDate = getEffectiveCalculationDate(t);
        const baseDate = t.effectiveInterestDate || proj?.interestStartDate;
        const interest = calculateInterestSmart(base, baseDate, calcDate);
        return acc + base + interest + (t.supplementaryAmount || 0);
      }, 0);
      return { thang: label, thucTe: disbursedInMonth, keHoach: 0 };
    });
  }, [statsDisbursedTrans, resolveProject, getEffectiveCalculationDate, calculateInterestSmart, startDate, endDate]);

  const balanceTrendData = useMemo(() => {
    const now = new Date();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const getPendingAmountAt = (d: Date): number => {
      const endTime = d.getTime();
      let total = 0;
      for (const t of filteredTransactions) {
        const disbursedAt = t.disbursementDate ? new Date(t.disbursementDate).getTime() : null;
        if (disbursedAt !== null && disbursedAt <= endTime) continue;
        const project = resolveProject(t);
        const baseDate = t.effectiveInterestDate || project?.interestStartDate || (project as any)?.startDate;
        if (baseDate && new Date(baseDate).getTime() > endTime) continue;
        const principalBase = (t as any).principalForInterest ?? t.compensation.totalApproved;
        const interest = calculateInterestSmart(principalBase, baseDate, d);
        const supplementary = t.supplementaryAmount || 0;
        total += principalBase + interest + supplementary;
      }
      return total;
    };

    const soDuAt = (d: Date): number => roundTo2(getPendingAmountAt(d));

    // Determine chart date range
    let rangeStart: Date;
    let rangeEnd: Date;

    if (startDate && endDate) {
      rangeStart = new Date(startDate);
      rangeEnd = new Date(endDate);
    } else if (endDate) {
      rangeEnd = new Date(endDate);
      rangeStart = new Date(rangeEnd);
      rangeStart.setDate(rangeEnd.getDate() - 6);
    } else if (startDate) {
      rangeStart = new Date(startDate);
      rangeEnd = new Date(todayEnd);
    } else {
      rangeEnd = new Date(todayEnd);
      rangeStart = new Date(rangeEnd);
      rangeStart.setDate(rangeEnd.getDate() - 6);
    }

    rangeStart.setHours(23, 59, 59, 999);
    rangeEnd.setHours(23, 59, 59, 999);

    if (rangeStart.getTime() > rangeEnd.getTime()) {
      const tmp = rangeStart;
      rangeStart = rangeEnd;
      rangeEnd = tmp;
    }

    const rangeDays = Math.max(1, Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 3600 * 24)));
    const MAX_BALANCE_POINTS = 15;
    let stepDays = 1;
    if (rangeDays > 31) stepDays = 7;
    if (rangeDays > 180) stepDays = 30;
    if (Math.ceil(rangeDays / stepDays) > MAX_BALANCE_POINTS) {
      stepDays = Math.ceil(rangeDays / MAX_BALANCE_POINTS);
    }

    const result: { ngay: string; soDu: number }[] = [];
    const cursor = new Date(rangeStart);
    while (cursor.getTime() <= rangeEnd.getTime()) {
      const d = new Date(cursor);
      d.setHours(23, 59, 59, 999);
      const label = rangeDays > 180
        ? `${d.getMonth() + 1}/${d.getFullYear()}`
        : `${d.getDate()}/${d.getMonth() + 1}`;
      result.push({ ngay: label, soDu: soDuAt(d) });
      cursor.setDate(cursor.getDate() + stepDays);
    }

    // Ensure last point is always the range end
    const lastEntry = result[result.length - 1];
    const endLabel = rangeDays > 180
      ? `${rangeEnd.getMonth() + 1}/${rangeEnd.getFullYear()}`
      : `${rangeEnd.getDate()}/${rangeEnd.getMonth() + 1}`;
    if (!lastEntry || lastEntry.ngay !== endLabel) {
      result.push({ ngay: endLabel, soDu: soDuAt(rangeEnd) });
    }

    return result;
  }, [filteredTransactions, resolveProject, calculateInterestSmart, startDate, endDate]);

  const paymentListForTable = useMemo(() => {
    const rawTerms = pendingSearch
      .split(/[,:\uFF0C]/)
      .map(t => t.trim())
      .filter(t => t.length > 0);

    const mapped = filteredTransactions.map(t => {
      const proj = projects.find(p => p.id === t.projectId || (p as any)._id === t.projectId);
      const effectiveStatus = getEffectiveStatus(t);
      const principalBase = (t as any).principalForInterest ?? t.compensation?.totalApproved ?? 0;
      const baseDate = t.effectiveInterestDate || proj?.interestStartDate;
      const calcDate = getEffectiveCalculationDate(t);
      const laiPhatSinh = calculateInterestSmart(principalBase, baseDate, calcDate);
      const supplementary = t.supplementaryAmount || 0;
      const totalAvailable = principalBase + laiPhatSinh + supplementary;
      // Always use computed values (except partial withdraw) so amounts match latest calculation dates.
      const tongChiTra = (t as any).withdrawnAmount ? (t as any).withdrawnAmount : totalAvailable;
      const ngayGN = effectiveStatus === TransactionStatus.DISBURSED && t.disbursementDate
        ? formatDate(t.disbursementDate)
        : baseDate ? formatDate(baseDate) : '-';
      return { t, proj, effectiveStatus, ngayGN, laiPhatSinh, tongChiTra };
    });

    if (rawTerms.length === 0) return mapped;

    const formatAmountForSearch = (amount: number) => Math.round(amount).toString().replace(/\s/g, '');

    return mapped.filter(row => {
      return rawTerms.every(termRaw => {
        const term = termRaw.toLowerCase();
        const numericTerm = termRaw.replace(/[,.\s]/g, '');
        const totalApprovedStr = formatAmountForSearch(row.t.compensation?.totalApproved ?? 0);
        const interestStr = formatAmountForSearch(row.laiPhatSinh);
        const totalStr = formatAmountForSearch(row.tongChiTra);
        const supplementaryStr = formatAmountForSearch(row.t.supplementaryAmount || 0);
        const relevantDate = row.t.effectiveInterestDate || row.proj?.interestStartDate;
        const displayDateStr = relevantDate ? formatDate(relevantDate) : '';

        return (
          row.effectiveStatus.toLowerCase().includes(term) ||
          (row.t.household?.name || '').toLowerCase().includes(term) ||
          (row.t.household?.id || '').toLowerCase().includes(term) ||
          (row.t.household?.cccd || '').includes(termRaw) ||
          (row.t.household?.decisionNumber || '').toLowerCase().includes(term) ||
          (row.t.id || '').toLowerCase().includes(term) ||
          displayDateStr.includes(termRaw) ||
          row.ngayGN.includes(termRaw) ||
          (row.t.paymentType || '').toLowerCase().includes(term) ||
          (row.proj?.code || '').toLowerCase().includes(term) ||
          totalApprovedStr.includes(numericTerm) ||
          interestStr.includes(numericTerm) ||
          totalStr.includes(numericTerm) ||
          supplementaryStr.includes(numericTerm)
        );
      });
    });
  }, [filteredTransactions, pendingSearch, projects, getEffectiveStatus, getEffectiveCalculationDate, calculateInterestSmart]);

  const PAYMENT_LIST_PAGE_SIZE = 20;
  const paymentListPaginated = useMemo(
    () => paymentListForTable.slice(paymentListPage * PAYMENT_LIST_PAGE_SIZE, paymentListPage * PAYMENT_LIST_PAGE_SIZE + PAYMENT_LIST_PAGE_SIZE),
    [paymentListForTable, paymentListPage]
  );
  const paymentListTotalPages = Math.ceil(paymentListForTable.length / PAYMENT_LIST_PAGE_SIZE) || 1;

  const handleDownloadPaymentList = () => {
    exportTransactionsToExcel(
      filteredTransactions,
      projects,
      interestRate,
      interestRateChangeDate ?? null,
      interestRateBefore ?? null,
      interestRateAfter ?? null,
      endDate || null
    );
  };

  const toggleProjectSelection = (id: string) => {
    setSelectedProjectIds(prev =>
      prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]
    );
  };

  const quickActionsAll = [
    { id: 'dashboard', label: 'Trang chủ' },
    { id: 'projects', label: 'Dự án' },
    { id: 'transactions', label: 'Giao dịch' },
    { id: 'balance', label: 'Hoạt động' },
    { id: 'admin', label: 'Admin' },
  ];
  const quickActions = quickActionsAll.filter((action) => {
    if (currentUser.role === 'Admin' || currentUser.role === 'SuperAdmin') return true;
    if (action.id === 'balance') return currentUser.permissions?.includes('transactions') || currentUser.permissions?.includes('balance');
    if (action.id === 'admin') return false;
    return currentUser.permissions?.includes(action.id);
  });

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const project = projects.find(p => p.code === label);
      const title = project ? project.name : label;

      return (
        <div className="bg-white/95 backdrop-blur-xl p-3 rounded-lg shadow-xl border border-slate-200 text-xs z-50">
          <p className="font-bold text-black mb-2 pb-1 border-b border-slate-200 max-w-[200px] truncate">{title}</p>
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex justify-between gap-6 mb-1.5 last:mb-0 items-center">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: entry.color }} />
                <span className="text-slate-600 font-medium">{entry.name}:</span>
              </div>
              <span className="font-bold text-slate-900">
                {(entry.unit === '%' || entry.name.includes('Tiến độ') || entry.name.includes('Hoàn thành'))
                  ? `${entry.value}%`
                  : formatCurrency(entry.value as number)}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const isDetailedView = selectedProjectIds.length > 0;

  const VN_BLUE = '#005992';
  const VN_BLUE_LIGHT = '#0ea5e9';

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Header */}
      <div className="pb-4 border-b-2 border-slate-300">
        <div className="flex flex-wrap justify-between items-end gap-4">
          <h2 className="text-2xl font-bold text-[#0f172a] tracking-tight">Trang chủ</h2>
          <div className="text-right">
            <p className="text-xs font-medium text-slate-500">{endDate ? 'Tổng dư tại mốc đến ngày (VND)' : 'Tổng dư hiện có (VND)'}</p>
            <p className="text-2xl font-bold" style={{ color: VN_BLUE }}>{formatCurrency(displayBalance)}</p>
          </div>
        </div>
      </div>

      {/* Bộ lọc */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h3 className="text-base font-bold text-[#0f172a]">Bộ lọc</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Từ ngày</label>
            <input
              type="date"
              value={inputStartDate}
              onChange={(e) => setInputStartDate(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Đến ngày</label>
            <input
              type="date"
              value={inputEndDate}
              onChange={(e) => setInputEndDate(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t border-slate-100">
          <span className="text-xs text-slate-500">Đang lọc: {formattedStart} → {formattedEnd}</span>
          <span className="text-xs text-slate-500">{filteredTransactions.length} giao dịch khớp</span>
          {(inputStartDate !== startDate || inputEndDate !== endDate) && (
            <span className="text-xs text-amber-600 animate-pulse">Đang cập nhật...</span>
          )}
          {(inputStartDate || inputEndDate) && (
            <button
              onClick={() => { setInputStartDate(''); setInputEndDate(''); setStartDate(''); setEndDate(''); }}
              className="text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              Xóa lọc
            </button>
          )}
        </div>
      </div>

      {/* Tài khoản thanh toán | Biến động số dư */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-base font-bold text-[#0f172a] mb-1">Tài khoản thanh toán</h3>
          <p className="text-xs text-slate-500 mb-4">Hiện có 1 tài khoản</p>
          <div className="flex items-center justify-between py-3 border-b border-slate-100">
            <div>
              <p className="text-xs text-slate-500">Tài khoản chính</p>
              <p className="text-lg font-semibold text-[#0f172a]">{formatCurrency(displayBalance)} VND</p>
            </div>
            <button onClick={() => onOpenBalanceModal()} className="text-sm font-semibold text-blue-600 hover:text-blue-700">
              Chi tiết
            </button>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-base font-bold text-[#0f172a] mb-3">Biến động số dư</h3>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={balanceTrendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="fillSoDu" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={VN_BLUE_LIGHT} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={VN_BLUE_LIGHT} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="ngay" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis
                tickFormatter={(v) => (v >= 1e9 ? `${(v / 1e9).toFixed(1)} tỷ` : v >= 1e6 ? `${(v / 1e6).toFixed(0)} tr` : `${(v / 1e3).toFixed(0)}K`)}
                tick={{ fontSize: 12, fill: '#334155', fontWeight: 600 }}
                axisLine={false}
                tickLine={false}
                width={56}
              />
              <Tooltip formatter={(v: number) => [formatCurrency(v), 'Số dư']} />
              <Area type="monotone" dataKey="soDu" stroke={VN_BLUE} strokeWidth={2} fill="url(#fillSoDu)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Thống kê tổng quan */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h3 className="text-base font-bold text-[#0f172a]">Thống kê tổng quan</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          {[
            { label: 'Tiền chưa giải ngân (theo phê duyệt)', value: formatCurrency(statsPendingByApprovalOnly), accent: 'border-l-blue-500' },
            { label: 'Tổng giá trị dự án', value: formatCurrency(statsTotalProjectValueUploaded), accent: 'border-l-indigo-500' },
            { label: 'Tiền đã giải ngân', value: formatCurrency(statsDisbursedAmount), accent: 'border-l-violet-500' },
            { label: endDate ? 'Tiền chưa giải ngân (mốc đến ngày)' : 'Số dư ngân hàng', value: formatCurrency(displayBalance), accent: 'border-l-emerald-500' },
            { label: 'Chưa giải ngân', value: statsPendingCount, accent: 'border-l-slate-400' },
            { label: 'Đã giải ngân', value: statsDisbursedTrans.length, accent: 'border-l-green-500' },
            { label: 'Tổng lãi', value: formatCurrency(statsTotalInterestRounded), accent: 'border-l-amber-500' },
          ].map((k, i) => (
            <div
              key={i}
              className={`flex flex-col justify-center text-left p-4 rounded-xl bg-slate-50/80 border border-slate-100 min-h-[88px] border-l-4 ${k.accent}`}
            >
              <p className="text-xs font-medium text-slate-600 mb-1.5 leading-snug">{k.label}</p>
              <p className="text-sm font-bold text-[#0f172a] leading-tight">{k.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Trạng thái giao dịch | Biến động giải ngân */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-base font-bold text-[#0f172a] mb-4">Trạng thái giao dịch</h3>
          <div className="flex justify-center">
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <ResponsiveContainer width={200} height={200}>
                <PieChart>
                  <Pie
                    data={donutStatusData.length ? donutStatusData : [{ name: 'Không có dữ liệu', value: 1, color: '#e2e8f0' }]}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                  >
                    {(donutStatusData.length ? donutStatusData : [{ name: '', value: 1, color: '#e2e8f0' }]).map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [formatCurrency(v), '']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-3">
                {(() => {
                  const total = donutStatusData.reduce((s, d) => s + d.value, 0);
                  return donutStatusData.map((d) => {
                    const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0';
                    return (
                      <div key={d.name} className="flex items-start gap-2">
                        <span className="w-3 h-3 rounded-full flex-shrink-0 mt-1" style={{ background: d.color }} />
                        <div>
                          <span className="text-sm font-medium text-slate-800 block">{d.name} ({pct}%)</span>
                          <span className="text-xs font-bold text-slate-900 block">{formatCurrency(d.value)}</span>
                          <span className="text-[11px] text-slate-500">{d.count} hộ</span>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-base font-bold text-[#0f172a] mb-4">Biến động giải ngân</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={disbursementTrendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="fillThucTe" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={VN_BLUE_LIGHT} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={VN_BLUE_LIGHT} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="thang" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => `${(v / 1e9).toFixed(0)} Tỷ`} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={40} />
              <Tooltip formatter={(v: number) => [formatCurrency(v), 'Thực tế']} labelFormatter={(l) => l} />
              <Area type="monotone" dataKey="thucTe" name="Thực tế giải ngân" stroke={VN_BLUE} strokeWidth={2} fill="url(#fillThucTe)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tab */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base font-bold text-[#0f172a]">Tab</h3>
          <span className="text-xs text-slate-500">Tuỳ chỉnh</span>
        </div>
        <div className="flex flex-wrap gap-2 sm:gap-3">
          {quickActions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => {
                if (action.id === 'balance') return onOpenBalanceModal();
                return setActiveTab(action.id);
              }}
              className="min-w-[100px] px-4 py-2.5 rounded-lg text-sm font-semibold text-[#0f172a] bg-slate-50 border border-slate-200 hover:bg-slate-100 hover:border-slate-300 transition-colors text-center"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {/* Danh sách chi trả */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 overflow-hidden">
        <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
          <h3 className="text-base font-bold text-[#0f172a]">Danh sách chi trả</h3>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Tìm theo Tên, Mã GD, Số QĐ, Số tiền... (dấu , để thêm điều kiện)"
              value={pendingSearch}
              onChange={(e) => { setPendingSearch(e.target.value); setPaymentListPage(0); }}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm w-80 max-w-full focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              type="button"
              onClick={handleDownloadPaymentList}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition-colors"
              title="Tải xuống Excel (toàn bộ danh sách)"
            >
              Tải Excel
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse text-center">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 divide-x divide-slate-200">
                <th className="text-[10px] font-bold text-black uppercase tracking-wide py-3 px-2 text-center whitespace-nowrap">STT</th>
                <th className="text-[10px] font-bold text-black uppercase tracking-wide py-3 px-2 text-center whitespace-nowrap">Mã GD</th>
                <th className="text-[10px] font-bold text-black uppercase tracking-wide py-3 px-2 text-center whitespace-nowrap">Mã hộ dân</th>
                <th className="text-[10px] font-bold text-black uppercase tracking-wide py-3 px-2 text-center whitespace-nowrap">Mã dự án</th>
                <th className="text-[10px] font-bold text-black uppercase tracking-wide py-3 px-2 text-center whitespace-nowrap">Họ và tên</th>
                <th className="text-[10px] font-bold text-black uppercase tracking-wide py-3 px-2 text-center whitespace-nowrap">Loại chi trả</th>
                <th className="text-[10px] font-bold text-black uppercase tracking-wide py-3 px-2 text-center whitespace-nowrap">Số quyết định</th>
                <th className="text-[10px] font-bold text-black uppercase tracking-wide py-3 px-2 text-center whitespace-nowrap">Ngày giải ngân</th>
                <th className="text-[10px] font-bold text-black uppercase tracking-wide py-3 px-2 text-center whitespace-nowrap">Lãi phát sinh</th>
                <th className="text-[10px] font-bold text-black uppercase tracking-wide py-3 px-2 text-center whitespace-nowrap">Tổng chi trả</th>
                <th className="text-[10px] font-bold text-black uppercase tracking-wide py-3 px-2 text-center whitespace-nowrap">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {paymentListPaginated.length === 0 ? (
                <tr><td colSpan={11} className="py-8 text-center text-slate-500">Không có dữ liệu chi trả</td></tr>
              ) : (
                paymentListPaginated.map((row, idx) => (
                  <tr key={row.t.id} className="border-b border-slate-100 hover:bg-slate-50 divide-x divide-slate-100">
                    <td className="py-2 px-2 text-center font-medium text-slate-600">{paymentListPage * PAYMENT_LIST_PAGE_SIZE + idx + 1}</td>
                    <td className="py-2 px-2 text-center font-medium text-blue-600 text-xs">{row.t.id}</td>
                    <td className="py-2 px-2 text-center font-mono text-xs text-slate-600">{row.t.household?.id ?? '-'}</td>
                    <td className="py-2 px-2 text-center"><span className="text-xs font-semibold bg-blue-50 px-1.5 py-0.5 rounded text-blue-700">{row.proj?.code ?? '-'}</span></td>
                    <td className="py-2 px-2 text-center font-medium text-slate-800">{row.t.household?.name ?? '-'}</td>
                    <td className="py-2 px-2 text-center text-xs text-slate-600">{row.t.paymentType || '-'}</td>
                    <td className="py-2 px-2 text-center text-xs font-medium text-slate-700">{row.t.household?.decisionNumber ?? '-'}</td>
                    <td className="py-2 px-2 text-center text-xs text-slate-600">{row.ngayGN}</td>
                    <td className="py-2 px-2 text-center font-medium text-rose-600">{row.laiPhatSinh > 0 ? formatCurrency(row.laiPhatSinh) : '-'}</td>
                    <td className="py-2 px-2 text-center font-bold text-[#0f172a]">{formatCurrency(row.tongChiTra)}</td>
                    <td className="py-2 px-2 text-center">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${row.effectiveStatus === TransactionStatus.DISBURSED ? 'text-green-700 font-bold' : row.effectiveStatus === TransactionStatus.HOLD ? 'bg-blue-100 text-blue-700' : 'text-[#005992] font-bold'}`}>
                        {row.effectiveStatus}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          {filteredTransactions.length > 0 && (
            <button type="button" onClick={() => setActiveTab('transactions')} className="text-sm font-semibold text-blue-600 hover:text-blue-700">Xem tất cả giao dịch</button>
          )}
          {paymentListTotalPages > 1 && (
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={() => setPaymentListPage((p) => Math.max(0, p - 1))}
                disabled={paymentListPage === 0}
                className="px-3 py-1.5 text-sm font-medium border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700"
              >
                Trang trước
              </button>
              <span className="text-sm text-slate-500 min-w-[80px] text-center">
                Trang {paymentListPage + 1} / {paymentListTotalPages}
              </span>
              <button
                type="button"
                onClick={() => setPaymentListPage((p) => Math.min(paymentListTotalPages - 1, p + 1))}
                disabled={paymentListPage >= paymentListTotalPages - 1}
                className="px-3 py-1.5 text-sm font-medium border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700"
              >
                Trang sau
              </button>
            </div>
          )}
        </div>
      </div>

      {/* So sánh quy mô | Cơ cấu dòng tiền */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-base font-bold text-[#0f172a] mb-4">So sánh quy mô và tiến độ dự án</h3>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={chartDataDisplay} layout="vertical" margin={{ top: 8, right: 24, left: 60, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => `${(v / 1e9).toFixed(0)} Tỷ`} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="code" width={56} tick={{ fontSize: 11, fill: '#0f172a' }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v: number) => [formatCurrency(v), '']} labelFormatter={(l) => chartDataDisplay.find(p => p.code === l)?.name || l} />
              <Legend />
              <Bar dataKey="totalBudget" name="Tổng vốn" fill="#94a3b8" radius={[0, 4, 4, 0]} barSize={14} />
              <Bar dataKey="disbursedAmount" name="Đã giải ngân" fill={VN_BLUE} radius={[0, 4, 4, 0]} barSize={14} />
            </BarChart>
          </ResponsiveContainer>
          {chartData.length > MAX_PROJECTS_CHART && (
            <p className="text-xs text-slate-500 mt-2">Đang hiển thị {MAX_PROJECTS_CHART} / {chartData.length} dự án</p>
          )}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-base font-bold text-[#0f172a] mb-4">Cơ cấu dòng tiền theo dự án</h3>
          <p className="text-xs text-slate-500 mb-2">Rê chuột lên cột để xem lãi phát sinh và mức độ hoàn thành</p>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={chartDataDisplay} layout="vertical" margin={{ top: 8, right: 80, left: 60, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => `${(v / 1e9).toFixed(0)} Tỷ`} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="code" width={56} tick={{ fontSize: 11, fill: '#0f172a' }} axisLine={false} tickLine={false} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length || !label) return null;
                  const p = chartDataDisplay.find(x => x.code === label);
                  if (!p) return null;
                  return (
                    <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-sm">
                      <p className="font-semibold text-slate-800 mb-1.5">{p.name}</p>
                      <p className="text-slate-600">Đã giải ngân: {formatCurrency(p.disbursedAmount)}</p>
                      <p className="text-slate-600">Chưa giải ngân: {formatCurrency(p.pendingAmount)}</p>
                      <p className="text-amber-700 font-medium">Lãi phát sinh: {formatCurrency(p.interestAmount)}</p>
                      <p className="text-blue-600 font-semibold mt-1">Hoàn thành: {p.completionRate}%</p>
                    </div>
                  );
                }}
              />
              <Legend />
              <Bar dataKey="disbursedAmount" name="Đã giải ngân" stackId="a" fill={VN_BLUE} radius={[0, 0, 0, 0]} barSize={24} />
              <Bar dataKey="pendingAmount" name="Chưa giải ngân" stackId="a" fill="#94a3b8" radius={[0, 4, 4, 0]} barSize={24}>
                <LabelList dataKey="completionRate" position="right" formatter={(v: number) => `${v}%`} style={{ fontSize: 10, fill: '#475569' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {chartData.length > MAX_PROJECTS_CHART && (
            <p className="text-xs text-slate-500 mt-2">Đang hiển thị {MAX_PROJECTS_CHART} / {chartData.length} dự án</p>
          )}
        </div>
      </div>
    </div>
  );
};
