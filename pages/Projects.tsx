import React, { useRef, useState, useMemo, useCallback } from 'react';
import api from '../services/api';
import { GlassCard } from '../components/GlassCard';
import { formatDate, formatCurrency, calculateInterest, calculateInterestWithRateChange, exportProjectsToExcel, roundTo2 } from '../utils/helpers';
import { Plus, FolderKanban, Coins, Loader2, X, Check, FileSpreadsheet, Edit2, Eye, Calendar, Save, Tag, Type, Trash2, Search, ChevronLeft, ChevronRight, Download, LayoutGrid, List } from 'lucide-react';
import { Project, Transaction, TransactionStatus, User, Attachment } from '../types';

interface ProjectsProps {
  projects: Project[];
  transactions: Transaction[];
  currentUser: User;
  interestRate?: number;
  interestRateChangeDate?: string | null;
  interestRateBefore?: number | null;
  interestRateAfter?: number | null;
  onImport: (project: Project, transactions: Transaction[]) => void;
  onUpdateProject: (updatedProject: Project) => void;
  onViewDetails: (projectCode: string, projectName?: string) => void;
  onDeleteProject: (id: string) => void;
}

interface PreviewData {
  project: Project;
  transactions: Transaction[];
  rawRows: any[];
}

// Normalize date to local timezone before binding to <input type="date">
const toInputDateLocal = (d?: string | Date) => {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '';
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 10);
};

const randomString = (length: number) => Math.random().toString(36).substring(2, 2 + length).padEnd(length, '0');

const renameUploadedFile = (fileName: string) => {
  const dotIndex = fileName.lastIndexOf('.');
  const base = dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName;
  const ext = dotIndex >= 0 ? fileName.slice(dotIndex) : '';
  return `${base}_${randomString(6)}${ext}`;
};

const STATUS_COLUMNS = [
  { key: 'receiving', label: 'Tiếp nhận hồ sơ', dotClass: 'bg-slate-400', badgeBg: 'bg-slate-100', badgeText: 'text-slate-700', borderClass: 'border-t-slate-400' },
  { key: 'disbursing', label: 'Đang giải ngân', dotClass: 'bg-[#005992]', badgeBg: 'bg-[#005992]/10', badgeText: 'text-[#005992]', borderClass: 'border-t-[#005992]' },
  { key: 'completed', label: 'Đã tất toán', dotClass: 'bg-green-600', badgeBg: 'bg-green-50', badgeText: 'text-green-700', borderClass: 'border-t-green-600' },
] as const;

const getProgressColor = (percent: number): string => {
  if (percent >= 100) return 'bg-green-500';
  if (percent >= 70) return 'bg-rose-500';
  if (percent >= 40) return 'bg-amber-500';
  return 'bg-blue-500';
};

export const Projects: React.FC<ProjectsProps> = ({
  projects,
  transactions,
  interestRate = 0,
  interestRateChangeDate,
  interestRateBefore,
  interestRateAfter,
  currentUser,
  onImport,
  onUpdateProject,
  onViewDetails,
  onDeleteProject
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [currentAttachProject, setCurrentAttachProject] = useState<Project | null>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingAttachmentId, setUploadingAttachmentId] = useState<string | null>(null);
  const [pendingUpload, setPendingUpload] = useState<{ project: Project; file: File } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ project: Project; attachment: Attachment } | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [importMode, setImportMode] = useState<'create' | 'merge' | null>(null);

  // State for Editing
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  // State for Search, Pagination, View Mode
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('list');
  const itemsPerPage = viewMode === 'kanban' ? 10 : 12;

  const canManageLock = ['SuperAdmin', 'Admin', 'PMB'].includes(currentUser.role);

  const handleToggleProjectLock = async (project: Project) => {
    try {
      const updated = await api.projects.update(project.id, { locked: !project.locked });
      onUpdateProject(updated.data);
    } catch (err: any) {
      console.error('Toggle lock failed:', err);
      alert(err?.message || 'Không thể cập nhật trạng thái khóa dự án');
    }
  };

  const calculateInterestSmart = useCallback((
    principal: number,
    baseDate: string | undefined,
    endDate: Date
  ): number => {
    const hasRateChange = interestRateChangeDate && interestRateBefore != null && interestRateAfter != null;
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
    }
    return calculateInterest(principal, interestRate, baseDate, endDate);
  }, [interestRate, interestRateChangeDate, interestRateBefore, interestRateAfter]);

  const getProjectActualTotal = useCallback((project: Project): number => {
    const projectTrans = transactions.filter(t => {
      const pIdStr = (t.projectId && (t.projectId as any)._id) ? (t.projectId as any)._id.toString() : t.projectId?.toString();
      return pIdStr === project.id || pIdStr === (project as any)._id;
    });

    const actualTotal = projectTrans.reduce((sum, t) => {
      const supplementary = t.supplementaryAmount || 0;

      if (t.status === TransactionStatus.DISBURSED && (t as any).disbursedTotal) {
        return sum + (t as any).disbursedTotal;
      }

      const baseDate = t.effectiveInterestDate || project.interestStartDate;
      let interest = 0;
      if (t.status === TransactionStatus.DISBURSED && t.disbursementDate) {
        interest = calculateInterestSmart(t.compensation.totalApproved, baseDate, new Date(t.disbursementDate));
      } else if (t.status !== TransactionStatus.DISBURSED) {
        interest = calculateInterestSmart(t.compensation.totalApproved, baseDate, new Date());
      }
      return sum + t.compensation.totalApproved + interest + supplementary;
    }, 0);

    return actualTotal > 0 ? actualTotal : project.totalBudget;
  }, [transactions, calculateInterestSmart]);

  // Filter projects based on search term
  const filteredProjects = useMemo(() => {
    if (!searchTerm.trim()) return projects;

    const term = searchTerm.toLowerCase().trim();

    return projects.filter(project => {
      if (project.code?.toLowerCase().includes(term)) return true;
      if (project.name?.toLowerCase().includes(term)) return true;

      if (project.interestStartDate) {
        const dateStr = formatDate(project.interestStartDate).toLowerCase();
        if (dateStr.includes(term)) return true;
      }

      const actualTotal = getProjectActualTotal(project);
      const budgetStr = formatCurrency(actualTotal).toLowerCase();
      const budgetNum = actualTotal.toString();
      if (budgetStr.includes(term) || budgetNum.includes(term)) return true;

      const initialBudgetStr = formatCurrency(project.totalBudget).toLowerCase();
      const initialBudgetNum = project.totalBudget.toString();
      if (initialBudgetStr.includes(term) || initialBudgetNum.includes(term)) return true;

      return false;
    });
  }, [projects, searchTerm, getProjectActualTotal]);

  // Pre-compute stats for each project (shared by kanban + list views)
  const projectsWithStats = useMemo(() => {
    return filteredProjects.map(project => {
      const projectTrans = transactions.filter(t => {
        const pIdStr = (t.projectId && (t.projectId as any)._id) ? (t.projectId as any)._id.toString() : t.projectId?.toString();
        return pIdStr === project.id || pIdStr === (project as any)._id;
      });

      const disbursedFull = projectTrans
        .filter(t => t.status === TransactionStatus.DISBURSED)
        .reduce((acc, t) => {
          const supplementary = t.supplementaryAmount || 0;
          const baseDate = t.effectiveInterestDate || project.interestStartDate || (project as any).startDate;
          const interest = t.disbursementDate
            ? calculateInterestSmart(t.compensation.totalApproved, baseDate, new Date(t.disbursementDate))
            : 0;
          const computedTotal = roundTo2(t.compensation.totalApproved + interest + supplementary);
          // Always use computed values so UI stays consistent when interest calculation dates change.
          return acc + computedTotal;
        }, 0);

      const disbursedPartial = projectTrans
        .filter(t => t.status !== TransactionStatus.DISBURSED && (t as any).withdrawnAmount)
        .reduce((acc, t) => acc + ((t as any).withdrawnAmount || 0), 0);

      const disbursed = disbursedFull + disbursedPartial;

      const actualTotalBudget = projectTrans.reduce((sum, t) => {
        const supplementary = t.supplementaryAmount || 0;
        const baseDate = t.effectiveInterestDate || project.interestStartDate || (project as any).startDate;
        const principalBase = (t as any).principalForInterest ?? t.compensation.totalApproved;
        let interest = 0;
        if (t.status === TransactionStatus.DISBURSED && t.disbursementDate) {
          interest = calculateInterestSmart(t.compensation.totalApproved, baseDate, new Date(t.disbursementDate));
        } else if (t.status !== TransactionStatus.DISBURSED) {
          interest = calculateInterestSmart(principalBase, baseDate, new Date());
        }
        const computedTotal = roundTo2(principalBase + interest + supplementary);
        // For DISBURSED transactions we also rely on computed totals to reflect the latest calculation dates.
        return sum + computedTotal;
      }, 0);

      const percent = actualTotalBudget > 0 ? (disbursed / actualTotalBudget) * 100 : 0;

      // Tính riêng giá trị gốc (principal + supplementary, không lãi) và lãi
      const principalValue = projectTrans.reduce((sum, t) => {
        const principalBase = (t as any).principalForInterest ?? t.compensation.totalApproved;
        const supplementary = t.supplementaryAmount || 0;
        return sum + principalBase + supplementary;
      }, 0);
      const totalInterest = roundTo2(actualTotalBudget - principalValue);

      const disbursedCount = projectTrans.filter(t => t.status === TransactionStatus.DISBURSED).length;
      let status: string;
      if (disbursedCount === 0) status = 'receiving';
      else if (disbursedCount === projectTrans.length) status = 'completed';
      else status = 'disbursing';

      return { project, actualTotalBudget, disbursed, percent, percentStr: percent.toFixed(1), status, principalValue, totalInterest, transCount: projectTrans.length };
    });
  }, [filteredProjects, transactions, calculateInterestSmart]);

  const projectsByStatus = useMemo(() => {
    const groups: Record<string, typeof projectsWithStats> = {
      receiving: [], disbursing: [], completed: [],
    };
    projectsWithStats.forEach(p => { groups[p.status]?.push(p); });
    return groups;
  }, [projectsWithStats]);

  // Pagination
  const totalPages = viewMode === 'list'
    ? Math.ceil(projectsWithStats.length / itemsPerPage)
    : Math.ceil(Math.max(...STATUS_COLUMNS.map(c => (projectsByStatus[c.key] || []).length), 0) / itemsPerPage);
  const paginatedStats = projectsWithStats.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= Math.max(totalPages, 1)) {
      setCurrentPage(newPage);
    }
  };

  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, viewMode]);

  const handleNewProjectClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setIsUploading(true);

      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = e.target?.result as string;
        try {
          const res = await api.projects.import({
            fileData: base64,
            previewOnly: true
          });

          if (res.data) {
            setPreviewData({
              project: res.data.project,
              transactions: res.data.transactions,
              rawRows: res.data.transactions.map((t: any, i: number) => ({
                stt: t.stt || (i + 1),
                name: t.household.name,
                cccd: t.household.cccd,
                maHo: t.household.id,
                qd: t.household.decisionNumber,
                date: formatDate(t.household.decisionDate),
                projectCode: t.projectCode || res.data.project.code,
                projectName: t.projectName || res.data.project.name,
                paymentType: t.paymentType,
                amount: t.compensation.totalApproved
              }))
            });
          }
        } catch (err: any) {
          console.error('Parse file failed:', err);
          let errMsg = err.message || 'Không thể trúng xuất dữ liệu';

          if (err.isNetworkError || err.message?.includes('kết nối') || err.message?.includes('server')) {
            errMsg = err.message || 'Không thể kết nối đến server backend.\n\nVui lòng:\n1. Kiểm tra backend server đã chạy chưa\n2. Chạy lệnh: npm run dev:server\n3. Đảm bảo server đang chạy trên port 3001';
          } else if (err.detectedColumns && err.detectedColumns.length > 0) {
            errMsg += `\n\nCác cột tìm thấy: ${err.detectedColumns.join(', ')}`;
            if (err.suggestions) {
              errMsg += `\n\n- Tên: ${err.suggestions.name}\n- Số tiền: ${err.suggestions.amount}`;
            }
          }

          alert('Lỗi đọc file: ' + errMsg);
        } finally {
          setIsUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.onerror = () => {
        alert('Lỗi đọc file từ đĩa');
        setIsUploading(false);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAttachClick = (project: Project) => {
    setCurrentAttachProject(project);
    attachmentInputRef.current?.click();
  };

  const handleAttachmentChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !currentAttachProject) return;

    const renamedFileName = renameUploadedFile(file.name);
    const fileToUpload = new File([file], renamedFileName, { type: file.type });
    setPendingUpload({ project: currentAttachProject, file: fileToUpload });

    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    setCurrentAttachProject(null);
  };

  const clearPendingUpload = () => {
    setPendingUpload(null);
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  };

  const clearPendingDelete = () => {
    setPendingDelete(null);
  };

  const confirmPendingUpload = async () => {
    if (!pendingUpload || isUploading) return;
    setIsUploading(true);

    const { project, file } = pendingUpload;
    const attachmentId = String(Date.now());
    const attachment = {
      id: attachmentId,
      name: file.name,
      mimeType: file.type,
      url: '',
      uploadedAt: new Date().toISOString(),
      driverLink: null
    };

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      attachment.url = dataUrl;

      try {
        const res = await api.projects.uploadAttachment(project.id, attachment);
        const savedAttachment = res.data;

        const updated: Project = { ...project };
        updated.attachments = [...(updated.attachments || []), savedAttachment];
        onUpdateProject(updated);
      } catch (err) {
        console.error('Attachment upload failed:', err);
        alert('Lỗi upload file');
      } finally {
        setIsUploading(false);
        clearPendingUpload();
      }
    };
    reader.readAsDataURL(file);
  };

  const confirmPendingDelete = async () => {
    if (!pendingDelete) return;

    const { project, attachment } = pendingDelete;
    try {
      await api.projects.deleteAttachment(project.id!, attachment.id);
      const updated: Project = { ...project };
      updated.attachments = (updated.attachments || []).filter(a => a.id !== attachment.id);
      onUpdateProject(updated);
    } catch (err: any) {
      console.error('Delete attachment error:', err);
      const errorMsg = err?.message || err?.responseData?.error || 'Lỗi xóa file';
      alert(`Lỗi xóa file: ${errorMsg}`);
    } finally {
      clearPendingDelete();
    }
  };

  const handleProjectInfoChange = (field: keyof Project, value: string) => {
    setPreviewData(prev => {
      if (!prev) return null;
      return {
        ...prev,
        project: {
          ...prev.project,
          [field]: value
        }
      };
    });
  };

  const handleConfirmImport = async (mode: 'create' | 'merge') => {
    if (!previewData) return;

    try {
      const response = await api.projects.import({
        projectCode: previewData.project.code,
        projectName: previewData.project.name,
        location: previewData.project.location || '',
        interestStartDate: previewData.project.interestStartDate,
        transactions: previewData.transactions,
        previewOnly: false,
        importMode: mode
      });

      if (response.data?.skippedCount > 0) {
        const duplicateList = response.data.duplicates || [];
        const duplicateMsg = duplicateList
          .map((d: any) => `- ${d.name} (Mã: ${d.maHo}, Số tiền: ${formatCurrency(d.amount)})`)
          .join('\n');

        alert(
          `${mode === 'create' ? 'Tạo mới' : 'Merge'} thành công ${response.data.transactionCount} giao dịch.\n\n` +
          `Có ${response.data.skippedCount} giao dịch bị trùng đã bỏ qua:\n${duplicateMsg}`
        );
      } else {
        const progressMsg = response.data?.newProgressPercent
          ? `\nTiến độ dự án: ${response.data.newProgressPercent}%`
          : '';
        alert(`${mode === 'create' ? 'Tạo mới' : 'Merge'} thành công ${response.data.transactionCount} giao dịch!${progressMsg}`);
      }

      setPreviewData(null);
      setImportMode(null);

      if (onImport) {
        onImport(previewData.project, previewData.transactions);
      }
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';

      if (error.responseData?.duplicates && Array.isArray(error.responseData.duplicates)) {
        const duplicateList = error.responseData.duplicates;
        const duplicateMsg = duplicateList
          .map((d: any) => `- ${d.name} (Mã: ${d.maHo}, Số tiền: ${formatCurrency(d.amount)})`)
          .join('\n');

        alert(`Lỗi: ${errorMessage}\n\nGiao dịch trùng:\n${duplicateMsg}`);
      } else {
        alert(`Lỗi import: ${errorMessage}`);
      }
    }
  };

  const handleCancelPreview = () => {
    setPreviewData(null);
    setImportMode(null);
  };

  const openEditModal = (project: Project) => {
    setEditingProject({ ...project });
  };

  const saveProjectUpdate = () => {
    if (editingProject) {
      onUpdateProject(editingProject);
      setEditingProject(null);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in relative">
      {/* Hidden File Input */}
      <input
        type="file"
        accept=".xlsx, .xls, .csv"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
      />
      {/* Hidden Attachment Input (per-project) */}
      <input
        type="file"
        ref={attachmentInputRef}
        onChange={handleAttachmentChange}
        className="hidden"
      />

      {pendingUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Xác nhận upload tệp</h3>
                <p className="text-sm text-slate-500">Bạn có đồng ý upload tệp này vào dự án không?</p>
              </div>
              <button onClick={clearPendingUpload} className="text-slate-400 hover:text-slate-700">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3 text-sm text-slate-700 mb-6">
              <p><span className="font-semibold">Dự án:</span> {pendingUpload.project.code} - {pendingUpload.project.name}</p>
              <p><span className="font-semibold">Tên file:</span> {pendingUpload.file.name}</p>
              <p><span className="font-semibold">Dung lượng:</span> {(pendingUpload.file.size / 1024).toFixed(1)} KB</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={confirmPendingUpload}
                disabled={isUploading}
                className="flex-1 py-3 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUploading ? 'Đang xử lý...' : 'Đồng ý'}
              </button>
              <button
                onClick={clearPendingUpload}
                className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-colors"
              >
                Từ chối
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Xác nhận xóa tệp</h3>
                <p className="text-sm text-slate-500">Bạn có đồng ý xóa tệp này khỏi dự án không?</p>
              </div>
              <button onClick={clearPendingDelete} className="text-slate-400 hover:text-slate-700">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3 text-sm text-slate-700 mb-6">
              <p><span className="font-semibold">Dự án:</span> {pendingDelete.project.code} - {pendingDelete.project.name}</p>
              <p><span className="font-semibold">Tên file:</span> {pendingDelete.attachment.name}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={confirmPendingDelete}
                className="flex-1 py-3 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition-colors"
              >
                Đồng ý
              </button>
              <button
                onClick={clearPendingDelete}
                className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-colors"
              >
                Từ chối
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[#0f172a] tracking-tight">
            {viewMode === 'kanban' ? 'Bảng theo dõi dự án' : 'Danh sách dự án'}
          </h2>
          <p className="text-xs font-medium text-slate-500 mt-1">Quản lý tiến độ công việc & tiến độ giải ngân theo từng giai đoạn</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              placeholder="Tìm theo mã, tên dự án..."
              className="bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-sm text-black w-56 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-400"
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            />
          </div>
          <button
            onClick={() => exportProjectsToExcel(filteredProjects, transactions, interestRate, interestRateChangeDate, interestRateBefore, interestRateAfter)}
            className="p-1.5 bg-white border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 transition-all"
            title="Tải xuống Excel"
          >
            <Download size={16} />
          </button>
          <div className="flex border border-slate-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('kanban')}
              className={`p-1.5 transition-colors ${viewMode === 'kanban' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
              title="Kanban"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
              title="Danh sách"
            >
              <List size={16} />
            </button>
          </div>
          <button
            onClick={handleNewProjectClick}
            disabled={isUploading}
            className="flex items-center gap-2 px-4 py-1.5 text-xs font-bold bg-[#005992] text-white rounded-lg hover:bg-[#004a7a] shadow-sm transition-all disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} strokeWidth={3} />}
            <span>{isUploading ? 'ĐANG XỬ LÝ...' : 'Dự án mới'}</span>
          </button>
        </div>
      </div>

      {searchTerm && (
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
          Tìm thấy <span className="font-bold text-blue-600">{projectsWithStats.length}</span> dự án khớp với "{searchTerm}"
          <button onClick={() => { setSearchTerm(''); setCurrentPage(1); }} className="ml-1 text-blue-600 hover:text-blue-700 font-bold">Xóa lọc</button>
        </div>
      )}

      {/* ======== KANBAN VIEW ======== */}
      {viewMode === 'kanban' && (() => {
        const kanbanStart = (currentPage - 1) * itemsPerPage;
        const kanbanEnd = currentPage * itemsPerPage;
        return (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {STATUS_COLUMNS.map(col => {
                const allItems = projectsByStatus[col.key] || [];
                const pagedItems = allItems.slice(kanbanStart, kanbanEnd);
                return (
                  <div key={col.key} className={`bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden border-t-4 ${col.borderClass}`}>
                    <div className="px-4 py-3 flex items-center justify-between bg-slate-50/50">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${col.dotClass}`} />
                        <span className="text-sm font-bold text-[#0f172a]">{col.label}</span>
                      </div>
                      {allItems.length > 0 && (
                        <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{allItems.length}</span>
                      )}
                    </div>
                    <div className="px-3 pb-3 pt-2 space-y-3">
                      {pagedItems.map(({ project, actualTotalBudget, percent, percentStr, principalValue, totalInterest, transCount }) => (
                        <div
                          key={project.id}
                          className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-md hover:border-slate-300 transition-all cursor-pointer"
                          onClick={() => onViewDetails(project.code, project.name)}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-mono font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                              {project.code}
                            </span>
                            <span className="text-[11px] font-medium text-slate-500">{transCount} hộ</span>
                          </div>
                          <p className="text-sm font-bold text-[#0f172a] mt-2 line-clamp-2 leading-snug">{project.name}</p>
                          <div className="mt-3 space-y-1.5 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="text-slate-500">Ngày giải ngân</span>
                              <span className="font-bold text-[#0f172a]">{project.interestStartDate ? formatDate(project.interestStartDate) : '-'}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-500">Giá trị dự án</span>
                              <span className="font-semibold text-[#0f172a]">{formatCurrency(principalValue)}</span>
                            </div>
                            {totalInterest > 0 && (
                              <div className="flex items-center justify-between">
                                <span className="text-slate-500">Lãi phát sinh</span>
                                <span className="font-semibold text-rose-600">{formatCurrency(totalInterest)}</span>
                              </div>
                            )}
                            <div className="flex items-center justify-between pt-1.5 border-t border-slate-100">
                              <span className="text-slate-700 font-bold">Tổng giá trị</span>
                              <span className="font-bold text-[#0f172a]">{formatCurrency(actualTotalBudget)}</span>
                            </div>
                          </div>
                          <div className="mt-3 pt-2 border-t border-slate-100">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[11px] text-slate-500 font-medium">Tiến độ giải ngân</span>
                              <span className="text-[11px] font-bold text-[#0f172a]">{percentStr}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${getProgressColor(percent)}`} style={{ width: `${Math.min(percent, 100)}%` }} />
                            </div>
                          </div>
                        </div>
                      ))}
                      {pagedItems.length === 0 && (
                        <div className="text-center py-10 text-xs text-slate-400 italic">Không có dự án</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Kanban Pagination */}
            {(() => {
              const maxColItems = Math.max(...STATUS_COLUMNS.map(c => (projectsByStatus[c.key] || []).length), 0);
              const kanbanPages = Math.ceil(maxColItems / itemsPerPage);
              if (kanbanPages <= 1) return null;
              return (
                <div className="flex justify-center items-center gap-3 pt-2">
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors"
                  >
                    <ChevronLeft size={16} strokeWidth={2} />
                  </button>
                  <span className="text-xs font-bold text-slate-600">Trang {currentPage} / {kanbanPages}</span>
                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage >= kanbanPages}
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors"
                  >
                    <ChevronRight size={16} strokeWidth={2} />
                  </button>
                </div>
              );
            })()}
          </>
        );
      })()}

      {/* ======== LIST VIEW ======== */}
      {viewMode === 'list' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse text-center">
              <thead>
                <tr className="border-b border-slate-300 bg-slate-50 divide-x divide-slate-300">
                  <th className="sticky left-0 z-20 bg-slate-50 w-[110px] min-w-[110px] text-[10px] font-bold text-black uppercase tracking-wide py-3 px-3 text-center whitespace-nowrap">Mã dự án</th>
                  <th className="sticky left-[110px] z-20 bg-slate-50 shadow-[1px_0_0_0_#cbd5e1] text-[10px] font-bold text-black uppercase tracking-wide py-3 px-3 text-center whitespace-normal min-w-[240px] max-w-[420px]">Tên dự án</th>
                  <th className="text-[10px] font-bold text-black uppercase tracking-wide py-3 px-3 text-center whitespace-nowrap">Tổng mức (VNĐ)</th>
                  <th className="text-[10px] font-bold text-black uppercase tracking-wide py-3 px-3 text-center whitespace-nowrap">Tiến độ</th>
                  <th className="text-[10px] font-bold text-black uppercase tracking-wide py-3 px-3 text-center whitespace-nowrap">Trạng thái</th>
                  <th className="text-[10px] font-bold text-black uppercase tracking-wide py-3 px-3 text-center whitespace-nowrap">Khóa</th>
                  <th className="text-[10px] font-bold text-black uppercase tracking-wide py-3 px-3 text-center whitespace-nowrap">Ngày Upload</th>
                  <th className="text-[10px] font-bold text-black uppercase tracking-wide py-3 px-3 text-center whitespace-nowrap">Ngày giải ngân & Tính lãi</th>
                  <th className="text-[10px] font-bold text-black uppercase tracking-wide py-3 px-3 text-center whitespace-nowrap">Thao tác</th>
                  <th className="text-[10px] font-bold text-black uppercase tracking-wide py-3 px-3 text-center whitespace-nowrap">Tệp</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {paginatedStats.map(({ project, actualTotalBudget, percent, percentStr, status }) => {
                  const statusConfig = STATUS_COLUMNS.find(s => s.key === status)!;
                  const isLocked = !!project.locked;
                  const canModifyProject = !isLocked || canManageLock;
                  const canDeleteAttachments = !isLocked || canManageLock;
                  return (
                    <tr key={project.id} className="group border-b border-slate-200 hover:bg-slate-50 divide-x divide-slate-200">
                      <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 w-[110px] min-w-[110px] py-2.5 px-3 text-center">
                        <span className="text-xs font-semibold bg-blue-50 px-1.5 py-0.5 rounded text-blue-700">
                          {project.code}
                        </span>
                      </td>
                      <td className="sticky left-[110px] z-10 bg-white group-hover:bg-slate-50 shadow-[1px_0_0_0_#e2e8f0] py-2.5 px-3 text-center font-medium text-[#0f172a] min-w-[240px] max-w-[420px]">
                        <span className="line-clamp-2 whitespace-normal break-words">{project.name}</span>
                      </td>
                      <td className="py-2.5 px-3 text-center font-bold text-[#0f172a]">{formatCurrency(actualTotalBudget)}</td>
                      <td className="py-2.5 px-3 text-center">
                        <div className="flex items-center gap-2 justify-center">
                          <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${getProgressColor(percent)}`} style={{ width: `${Math.min(percent, 100)}%` }} />
                          </div>
                          <span className="text-[10px] font-bold text-[#0f172a] w-10">{percentStr}%</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap ${statusConfig.badgeBg} ${statusConfig.badgeText}`}>
                          {statusConfig.label}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {canManageLock ? (
                          <button
                            type="button"
                            onClick={() => handleToggleProjectLock(project)}
                            className={`text-[10px] font-bold px-2 py-1 rounded-full transition-colors ${project.locked ? 'bg-rose-100 text-rose-700 hover:bg-rose-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}
                            title={project.locked ? 'Mở khóa dự án' : 'Khóa dự án'}
                          >
                            {project.locked ? 'Mở khóa' : 'Khóa'}
                          </button>
                        ) : (
                          <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${project.locked ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {project.locked ? 'Khóa' : 'Mở khóa'}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center text-xs text-[#0f172a]">
                        {project.uploadDate ? formatDate(project.uploadDate) : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-center text-xs font-bold text-[#0f172a]">
                        {project.interestStartDate ? formatDate(project.interestStartDate) : 'Chưa thiết lập'}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => canModifyProject && openEditModal(project)}
                            disabled={!canModifyProject}
                            className={`p-1.5 rounded-lg transition-all ${canModifyProject ? 'text-slate-500 hover:text-blue-600 hover:bg-blue-100' : 'text-slate-300 cursor-not-allowed'}`}
                            title={canModifyProject ? 'Cập nhật dự án' : 'Dự án đang Khóa'}
                          >
                            <Edit2 size={15} strokeWidth={2} />
                          </button>
                          <button
                            onClick={() => onViewDetails(project.code, project.name)}
                            className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-100 rounded-lg transition-all"
                            title="Xem chi tiết"
                          >
                            <Eye size={15} strokeWidth={2} />
                          </button>
                          <button
                            onClick={() => {
                              if (!canModifyProject) return;
                              if (window.confirm('Bạn có chắc chắn muốn xóa dự án này? Tất cả hồ sơ liên quan sẽ bị xóa.')) {
                                onDeleteProject(project.id!);
                              }
                            }}
                            disabled={!canModifyProject}
                            className={`p-1.5 rounded-lg transition-all ${canModifyProject ? 'text-slate-400 hover:text-red-500 hover:bg-red-50' : 'text-slate-300 cursor-not-allowed'}`}
                            title={canModifyProject ? 'Xóa dự án' : 'Dự án đang Khóa'}
                          >
                            <Trash2 size={15} strokeWidth={2} />
                          </button>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleAttachClick(project)}
                            className="p-1.5 rounded-lg transition-all text-slate-500 hover:text-blue-600 hover:bg-blue-100"
                            title="Đính kèm tệp"
                          >
                            <Plus size={14} />
                          </button>
                          {project.attachments && project.attachments.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-2">
                              {project.attachments.map(att => (
                                <div key={att.id} className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-100 hover:border-slate-200 transition-all">
                                  <span className="text-xs text-slate-600 truncate" title={att.name} style={{ maxWidth: '15ch' }}>{att.name}</span>
                                  <button
                                    onClick={() => {
                                      const openUrl = att.driverLink || att.url;
                                      if (openUrl) window.open(openUrl, '_blank');
                                    }}
                                    className="text-slate-500 hover:text-emerald-600 transition-colors"
                                    title={att.driverLink ? 'Xem trên Drive' : 'Xem'}
                                  >
                                    <Eye size={14} />
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (!att.url) return;
                                      const a = document.createElement('a');
                                      a.href = att.url;
                                      a.download = att.name;
                                      document.body.appendChild(a);
                                      a.click();
                                      a.remove();
                                    }}
                                    className="text-slate-500 hover:text-blue-600 transition-colors"
                                    title="Tải về"
                                  >
                                    <Download size={14} />
                                  </button>
                                  {uploadingAttachmentId === att.id ? (
                                    <div className="text-slate-500 animate-spin">
                                      <Loader2 size={14} />
                                    </div>
                                  ) : att.driverLink ? (
                                    <div className="text-indigo-600 text-xs">✓ NAS</div>
                                  ) : (
                                    <button
                                      onClick={async () => {
                                        try {
                                          setUploadingAttachmentId(att.id);
                                          const synologyRes = await api.projects.uploadAttachmentToSynology(project.id!, att.id);
                                          const updated: Project = { ...project };
                                          const attachment = updated.attachments?.find(a => a.id === att.id);
                                          if (attachment) {
                                            attachment.driverLink = synologyRes?.data?.driveLink || attachment.driverLink;
                                          }
                                          onUpdateProject(updated);
                                        } catch (err) {
                                          alert('Tính năng đẩy lên Synology NAS chưa được cấu hình hoặc bị lỗi.');
                                        } finally {
                                          setUploadingAttachmentId(null);
                                        }
                                      }}
                                      className="transition-colors text-slate-500 hover:text-indigo-600"
                                      title="Lưu lên Drive"
                                    >
                                      <FolderKanban size={14} />
                                    </button>
                                  )}
                                  <button
                                    onClick={() => {
                                      if (!canDeleteAttachments) return;
                                      setPendingDelete({ project, attachment: att });
                                    }}
                                    disabled={!canDeleteAttachments}
                                    className={`transition-colors ${canDeleteAttachments ? 'text-slate-400 hover:text-red-500' : 'text-slate-300 cursor-not-allowed'}`}
                                    title={canDeleteAttachments ? 'Xóa' : 'Không có quyền xóa file'}
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="p-4 border-t border-slate-200 flex justify-between items-center">
              <div className="text-xs font-bold text-slate-500">
                Hiển thị {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, projectsWithStats.length)} trên tổng số {projectsWithStats.length} dự án
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors"
                >
                  <ChevronLeft size={16} strokeWidth={2} />
                </button>
                <div className="flex items-center justify-center px-3 bg-white border border-slate-200 rounded-lg text-xs font-bold text-blue-700 shadow-sm">
                  Trang {currentPage} / {totalPages}
                </div>
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors"
                >
                  <ChevronRight size={16} strokeWidth={2} />
                </button>
              </div>
            </div>
          )}

          {projectsWithStats.length === 0 && (
            <div className="p-12 text-center text-slate-400 font-medium">
              {searchTerm ? `Không tìm thấy dự án nào khớp với "${searchTerm}"` : 'Chưa có dự án nào'}
            </div>
          )}
        </div>
      )}

      {/* EDIT PROJECT MODAL */}
      {editingProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm animate-in fade-in zoom-in duration-200">
          <GlassCard className="w-[450px] bg-white p-6 shadow-2xl border-slate-300">
            <div className="flex justify-between items-start mb-6 border-b border-slate-200 pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Edit2 size={18} className="text-blue-600" />
                  Cập nhật dự án
                </h3>
                <p className="text-xs font-semibold text-slate-500 mt-1 max-w-[350px] truncate">{editingProject.name}</p>
              </div>
              <button onClick={() => setEditingProject(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-2 flex items-center gap-1.5">
                  <Type size={12} /> Tên dự án
                </label>
                <input
                  type="text"
                  value={editingProject.name}
                  onChange={(e) => setEditingProject({ ...editingProject, name: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Nhập tên dự án"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-2 flex items-center gap-1.5">
                  <Tag size={12} /> Mã dự án
                </label>
                <input
                  type="text"
                  value={editingProject.code}
                  onChange={(e) => setEditingProject({ ...editingProject, code: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono font-bold text-blue-700 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Nhập mã dự án"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-2 flex items-center gap-1.5">
                  <Calendar size={12} /> Ngày Giải Ngân & Tính Lãi
                </label>
                <div className="relative">
                  <input
                    type="date"
                    lang="vi"
                    value={toInputDateLocal(editingProject.interestStartDate)}
                    onChange={(e) => setEditingProject({ ...editingProject, interestStartDate: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1.5 italic font-medium">
                  * Mốc thời gian để tính lãi tự động cho hồ sơ chưa nhận tiền.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-8">
              <button
                onClick={() => setEditingProject(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200"
              >
                Hủy bỏ
              </button>
              <button
                onClick={saveProjectUpdate}
                className="px-5 py-2 text-xs font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all flex items-center gap-2"
              >
                <Save size={14} /> Lưu thay đổi
              </button>
            </div>
          </GlassCard>
        </div>
      )}

      {/* PREVIEW MODAL */}
      {previewData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4 animate-in fade-in zoom-in duration-200">
          <GlassCard className="w-[95vw] h-[90vh] flex flex-col p-0 overflow-hidden shadow-2xl border-slate-300 bg-white/95">

            {/* Modal Header */}
            <div className="flex justify-between items-center p-5 border-b border-slate-200 bg-slate-50/50">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-100 text-blue-600 rounded-lg border border-blue-200">
                  <FileSpreadsheet size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    Xác nhận nhập dữ liệu <span className="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded text-slate-500 font-mono">v1.1</span>
                  </h3>
                  <p className="text-xs text-slate-500 font-bold">Vui lòng kiểm tra kỹ thông tin trích xuất từ file Excel trước khi lưu.</p>
                </div>
              </div>
              <button
                onClick={handleCancelPreview}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body - Scrollable Area */}
            <div className="flex-1 overflow-hidden flex flex-col p-5 bg-slate-50/30">

              {/* Project Info Summary (Editable) */}
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 mb-6">
                <div className="sm:col-span-1 relative group">
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1 flex items-center gap-1">
                    Tên dự án <Edit2 size={10} className="text-slate-400" />
                  </label>
                  <input
                    value={previewData.project.name}
                    onChange={(e) => handleProjectInfoChange('name', e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded px-2 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-all shadow-sm"
                  />
                </div>
                <div className="sm:col-span-1">
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1 flex items-center gap-1">
                    Mã dự án <Edit2 size={10} className="text-slate-400" />
                  </label>
                  <input
                    value={previewData.project.code}
                    onChange={(e) => handleProjectInfoChange('code', e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded px-2 py-2 text-xs font-mono font-bold text-blue-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-all shadow-sm"
                  />
                </div>
                <div className="sm:col-span-1">
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1 flex items-center gap-1">
                    Ngày giải ngân & Tính lãi <Edit2 size={10} className="text-slate-400" />
                  </label>
                  <div className="relative flex">
                    <input
                      type="text"
                      readOnly
                      value={previewData.project.interestStartDate ? (() => {
                        const d = typeof previewData.project.interestStartDate === 'string'
                          ? new Date(previewData.project.interestStartDate)
                          : new Date(previewData.project.interestStartDate);
                        const day = String(d.getDate()).padStart(2, '0');
                        const month = String(d.getMonth() + 1).padStart(2, '0');
                        const year = d.getFullYear();
                        return `${day}/${month}/${year}`;
                      })() : ''}
                      placeholder="DD/MM/YYYY"
                      className="flex-1 bg-white border border-slate-200 rounded-l px-2 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-all shadow-sm cursor-pointer"
                      onClick={() => { if (dateInputRef.current?.showPicker) { dateInputRef.current.showPicker(); } else { dateInputRef.current?.click(); } }}
                    />
                    <button
                      type="button"
                      onClick={() => { if (dateInputRef.current?.showPicker) { dateInputRef.current.showPicker(); } else { dateInputRef.current?.click(); } }}
                      className="flex items-center justify-center px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-r cursor-pointer transition-colors"
                    >
                      <Calendar size={14} />
                    </button>
                    <input
                      ref={dateInputRef}
                      type="date"
                      value={previewData.project.interestStartDate ? (typeof previewData.project.interestStartDate === 'string' ? previewData.project.interestStartDate.split('T')[0] : new Date(previewData.project.interestStartDate).toISOString().split('T')[0]) : ''}
                      onChange={(e) => {
                        const newDate = e.target.value;
                        handleProjectInfoChange('interestStartDate', newDate);
                      }}
                      className="absolute top-0 left-0 opacity-0 w-full h-full pointer-events-none"
                    />
                  </div>
                </div>
                <div className="sm:col-span-1">
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">Tổng ngân sách</label>
                  <input
                    readOnly
                    value={formatCurrency(previewData.project.totalBudget)}
                    className="w-full bg-slate-100 border border-slate-200 rounded px-2 py-2 text-xs font-bold text-emerald-700 focus:outline-none text-right cursor-not-allowed"
                  />
                </div>
              </div>

              {/* Data Table Area */}
              <div className="flex-1 overflow-auto border border-slate-200 rounded-lg bg-white shadow-sm custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[1200px]">
                  <thead className="bg-slate-100 border-b border-slate-200">
                    <tr>
                      <th className="p-3 text-[10px] font-bold text-slate-700 uppercase tracking-wider border-r border-slate-200 text-center w-12">STT</th>
                      <th className="p-3 text-[10px] font-bold text-slate-700 uppercase tracking-wider border-r border-slate-200 min-w-[180px]">Họ và tên</th>
                      <th className="p-3 text-[10px] font-bold text-slate-700 uppercase tracking-wider border-r border-slate-200 min-w-[140px]">Mã Hộ Dân</th>
                      <th className="p-3 text-[10px] font-bold text-slate-700 uppercase tracking-wider border-r border-slate-200 min-w-[120px]">Số quyết định</th>
                      <th className="p-3 text-[10px] font-bold text-slate-700 uppercase tracking-wider border-r border-slate-200 min-w-[100px]">Ngày QD</th>
                      <th className="p-3 text-[10px] font-bold text-slate-700 uppercase tracking-wider border-r border-slate-200 min-w-[150px]">Loại chi trả</th>
                      <th className="p-3 text-[10px] font-bold text-slate-700 uppercase tracking-wider border-r border-slate-200 min-w-[100px]">Mã dự án</th>
                      <th className="p-3 text-[10px] font-bold text-slate-700 uppercase tracking-wider text-right min-w-[160px]">Số tiền chi trả</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs divide-y divide-slate-200">
                    {previewData.rawRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-blue-50/30 transition-colors even:bg-slate-50/20">
                        <td className="p-3 border-r border-slate-200 text-center font-medium text-slate-500">{row.stt}</td>
                        <td className="p-3 border-r border-slate-200 font-bold text-slate-800">{row.name}</td>
                        <td className="p-3 border-r border-slate-200 font-mono text-slate-600 text-[10px]">{row.maHo || '-'}</td>
                        <td className="p-3 border-r border-slate-200 text-slate-700">{row.qd || '-'}</td>
                        <td className="p-3 border-r border-slate-200 text-slate-700">{row.date || '-'}</td>
                        <td className="p-3 border-r border-slate-200 font-medium text-blue-600">{row.paymentType || '-'}</td>
                        <td className="p-3 border-r border-slate-200 text-slate-500 font-mono text-[10px]">{row.projectCode}</td>
                        <td className="p-3 text-right font-bold text-emerald-700">
                          {formatCurrency(row.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 text-[10px] text-slate-500 text-right italic font-medium">
                * Hiển thị {previewData.rawRows.length} bản ghi
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-slate-200 bg-white">
              {!importMode ? (
                <div className="flex flex-col gap-3">
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={() => setImportMode('create')}
                      className="px-6 py-2.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all flex items-center gap-2"
                    >
                      <Plus size={16} strokeWidth={3} />
                      Tạo dự án mới
                    </button>
                    <button
                      onClick={() => setImportMode('merge')}
                      className="px-6 py-2.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all flex items-center gap-2"
                    >
                      <FileSpreadsheet size={16} strokeWidth={3} />
                      Merge vào dự án có sẵn
                    </button>
                  </div>
                  <div className="flex justify-center">
                    <button
                      onClick={handleCancelPreview}
                      className="px-5 py-2.5 rounded-lg border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-100 transition-colors"
                    >
                      Hủy bỏ
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => {
                      setImportMode(null);
                      handleCancelPreview();
                    }}
                    className="px-5 py-2.5 rounded-lg border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-100 transition-colors"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    onClick={() => handleConfirmImport(importMode)}
                    className={`px-6 py-2.5 rounded-lg text-white text-xs font-bold shadow-lg transition-all flex items-center gap-2 ${importMode === 'create'
                      ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'
                      : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'
                      }`}
                  >
                    <Check size={16} strokeWidth={3} />
                    {importMode === 'create' ? 'Tạo mới' : 'Merge'}
                  </button>
                </div>
              )}
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
};
