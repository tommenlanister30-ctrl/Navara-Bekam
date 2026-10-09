"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  Clock,
  CheckCircle,
  AlertCircle,
  Save,
  Send,
  Copy,
  Award,
  Edit,
  Sparkles,
  AlertTriangle,
  User,
  DollarSign,
  Activity,
  Download,
  FileText,
  Table,
  RefreshCw,
  Building2,
} from "lucide-react";
import PageHeader from "@/components/layout/PageHeader";

type MonthlyReport = {
  id: string | null;
  therapistId: string;
  therapistName: string;
  branchId: string | null;
  branchName: string;
  month: string | null;
  startDate?: string | null;
  endDate?: string | null;
  totalTreatments: number;
  attendancePresent: number;
  attendanceLate: number;
  attendanceAbsent: number;
  attendancePermit: number;
  baseSalary: number;
  commissions: number;
  allowances: number;
  bonuses: number;
  deductions: number;
  takeHomePay: number;
  notesStrengths: string;
  notesImprovements: string;
  notesTargets: string;
  rating: string;
  isSaved: boolean;
};

type BranchGroup = {
  branchId: string;
  branchName: string;
  reports: MonthlyReport[];
};

export default function TherapistReportsPage() {
  const router = useRouter();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [filterMode, setFilterMode] = useState<"month" | "dateRange">("month");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
  });

  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("ALL");
  const [reports, setReports] = useState<MonthlyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bulking, setBulking] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [session, setSession] = useState<any>(null);

  // Modal Edit state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeReport, setActiveReport] = useState<MonthlyReport | null>(null);

  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
    // Fetch branches list
    fetch("/api/branches")
      .then((r) => r.json())
      .then((d) => {
        if (d.data) setBranches(d.data);
      })
      .catch(console.error);

    // Initial sync with cookie if present
    if (typeof document !== "undefined") {
      const match = document.cookie.match(new RegExp("(^| )navara-selected-branch=([^;]+)"));
      if (match && match[2]) {
        setSelectedBranch(match[2]);
      }
    }
  }, []);

  const fetchReports = useCallback(
    async (targetMonth: string, start?: string, end?: string, branch?: string) => {
      setLoading(true);
      setMessage(null);
      try {
        let url =
          filterMode === "month"
            ? `/api/therapist-reports?month=${targetMonth}`
            : `/api/therapist-reports?startDate=${start}&endDate=${end}`;

        if (branch && branch !== "ALL") {
          url += `&branchId=${branch}`;
        }

        const [res, sessionRes] = await Promise.all([
          fetch(url),
          fetch("/api/auth/session"),
        ]);
        if (res.ok) {
          const json = await res.json();
          setReports(json.data || []);
        } else {
          setMessage({
            type: "error",
            text: "Gagal memuat data rapor terapis",
          });
        }
        if (sessionRes.ok) {
          const sJson = await sessionRes.json();
          setSession(sJson.session);
        }
      } catch (err) {
        console.error(err);
        setMessage({ type: "error", text: "Terjadi kesalahan koneksi" });
      } finally {
        setLoading(false);
      }
    },
    [filterMode],
  );

  useEffect(() => {
    fetchReports(month, startDate, endDate, selectedBranch);
  }, [month, startDate, endDate, filterMode, selectedBranch, fetchReports]);

  const handleEditClick = (report: MonthlyReport) => {
    setActiveReport({ ...report });
    setIsModalOpen(true);
  };

  const handleModalInputChange = (field: keyof MonthlyReport, value: any) => {
    if (!activeReport) return;

    setActiveReport((prev) => {
      if (!prev) return null;
      const updated = { ...prev, [field]: value } as MonthlyReport;

      // Recalculate Take-Home Pay dynamically if financial fields change
      if (
        field === "baseSalary" ||
        field === "commissions" ||
        field === "allowances" ||
        field === "bonuses" ||
        field === "deductions"
      ) {
        const salary = parseInt(String(updated.baseSalary)) || 0;
        const comms = parseInt(String(updated.commissions)) || 0;
        const allow = parseInt(String(updated.allowances)) || 0;
        const bonus = parseInt(String(updated.bonuses)) || 0;
        const deduct = parseInt(String(updated.deductions)) || 0;
        updated.takeHomePay = salary + comms + allow + bonus - deduct;
      }
      return updated;
    });
  };

  const handleSaveReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeReport) return;
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/therapist-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(activeReport),
      });

      if (res.ok) {
        setMessage({
          type: "success",
          text: `Rapor ${activeReport.therapistName} berhasil disimpan!`,
        });
        setIsModalOpen(false);
        fetchReports(month, startDate, endDate);
      } else {
        const errJson = await res.json();
        setMessage({
          type: "error",
          text: errJson.error || "Gagal menyimpan rapor",
        });
      }
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Terjadi kesalahan sistem" });
    } finally {
      setSaving(false);
    }
  };

  const filteredReports = reports;

  // Group reports by branch for display
  const branchGroups: BranchGroup[] = (() => {
    const groupMap = new Map<string, BranchGroup>();
    filteredReports.forEach((r) => {
      const key = r.branchId || "no-branch";
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          branchId: key,
          branchName: r.branchName || "Tanpa Cabang",
          reports: [],
        });
      }
      groupMap.get(key)!.reports.push(r);
    });
    return Array.from(groupMap.values());
  })();

  const handleBulkSave = async (specificReports?: MonthlyReport[]) => {
    const targetList = specificReports || filteredReports;
    const unsaved = targetList.filter((r) => !r.isSaved);
    if (unsaved.length === 0)
      return alert("Semua laporan terapis untuk periode ini sudah tersimpan.");
    if (
      !confirm(
        `Simpan masal ${unsaved.length} draft laporan terapis sekaligus?`,
      )
    )
      return;

    setBulking(true);
    setMessage(null);
    let successCount = 0;

    try {
      for (const report of unsaved) {
        const res = await fetch("/api/therapist-reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(report),
        });
        if (res.ok) successCount++;
      }

      setMessage({
        type: "success",
        text: `Berhasil memproses & menyimpan ${successCount} laporan terapis!`,
      });
      fetchReports(month, startDate, endDate, selectedBranch);
    } catch (err) {
      console.error(err);
      setMessage({
        type: "error",
        text: "Terjadi kesalahan selama proses simpan masal",
      });
    } finally {
      setBulking(false);
    }
  };

  const handleDownloadSlipPDF = async (report: MonthlyReport) => {
    const { jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF("portrait");
    const readableMonth = getPeriodLabel(report);

    doc.setFontSize(16);
    doc.text("Slip Gaji Terapis", 105, 20, { align: "center" });

    doc.setFontSize(12);
    doc.text(`Klinik Navara Reflexology - Cabang ${report.branchName || "Pusat"}`, 105, 28, { align: "center" });
    
    doc.setFontSize(10);
    doc.text(`Nama Terapis: ${report.therapistName}`, 14, 43);
    doc.text(`Cabang Penempatan: ${report.branchName || "Pusat"}`, 14, 49);
    doc.text(`Periode: ${readableMonth}`, 14, 55);
    doc.text(`Total Penanganan: ${report.totalTreatments} Pasien`, 14, 61);
    doc.text(`Kehadiran (Hadir/Telat/Absen): ${report.attendancePresent} / ${report.attendanceLate} / ${report.attendanceAbsent}`, 14, 67);

    const tableData = [
      [{ content: "Keterangan", styles: { fontStyle: "bold", fillColor: [240, 240, 240] } }, { content: "Nominal", styles: { fontStyle: "bold", fillColor: [240, 240, 240], halign: "right" } }],
      ["Gaji Pokok", formatRupiah(report.baseSalary)],
      ["Komisi Tindakan", formatRupiah(report.commissions)],
      ["Tunjangan", formatRupiah(report.allowances)],
      ["Bonus", formatRupiah(report.bonuses)],
      ["Potongan", formatRupiah(report.deductions)],
      [{ content: "Take Home Pay (THP)", styles: { fontStyle: "bold" } }, { content: formatRupiah(report.takeHomePay), styles: { fontStyle: "bold", halign: "right" } }]
    ];

    autoTable(doc, {
      startY: 75,
      body: tableData as any,
      theme: "grid",
      columnStyles: {
        0: { cellWidth: 100 },
        1: { cellWidth: 80, halign: "right" }
      }
    });

    const finalY = (doc as any).lastAutoTable.finalY || 150;
    doc.text("Penerima", 40, finalY + 30, { align: "center" });
    doc.text(`(${report.therapistName})`, 40, finalY + 55, { align: "center" });

    doc.text("Manajemen", 170, finalY + 30, { align: "center" });
    doc.text("(...........................)", 170, finalY + 55, { align: "center" });

    const fileNameMonth = month || "Periode";
    const branchSafe = (report.branchName || "Cabang").replace(/\s+/g, "_");
    doc.save(`Slip_Gaji_${branchSafe}_${report.therapistName.replace(/\s+/g, "_")}_${fileNameMonth}.pdf`);
  };

  const handleSendWA = (report: MonthlyReport) => {
    if (!report.id) return;
    
    // Format period to readable string
    const readableMonth = getPeriodLabel(report);

    const messageText = `Halo ${report.therapistName}, berikut adalah informasi Slip Gaji Bulanan Anda (${report.branchName || "Cabang"}) untuk periode *${readableMonth}*.\n\nSilakan cek lampiran PDF yang kami kirimkan bersama pesan ini untuk melihat rincian Gaji Pokok, Komisi, Bonus, Potongan, dan Take Home Pay Anda. Terima kasih!`;

    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(messageText)}`;
    window.open(waUrl, "_blank");
  };

  const formatRupiah = (amount: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getMonthReadable = (monthCode: string | null | undefined) => {
    if (!monthCode) return "";
    const [y, m] = monthCode.split("-");
    return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString(
      "id-ID",
      { month: "long", year: "numeric" },
    );
  };

  const getPeriodLabel = (report: MonthlyReport) => {
    if (report.month) return getMonthReadable(report.month);
    if (report.startDate && report.endDate)
      return `${report.startDate} s/d ${report.endDate}`;
    return "-";
  };

  const handleExportExcel = async () => {
    if (filteredReports.length === 0)
      return alert("Tidak ada data untuk diekspor");

    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();

    // Export per-branch: each branch gets its own separate worksheet
    branchGroups.forEach((group) => {
      const formattedData = group.reports.map((r) => ({
        "Cabang": group.branchName,
        "Nama Terapis": r.therapistName,
        "Total Pasien": r.totalTreatments,
        "Kehadiran (H/T/A)": `${r.attendancePresent}/${r.attendanceLate}/${r.attendanceAbsent}`,
        "Gaji Pokok": r.baseSalary,
        "Komisi Tindakan": r.commissions,
        Tunjangan: r.allowances,
        Bonus: r.bonuses,
        Potongan: r.deductions,
        "Take Home Pay": r.takeHomePay,
        "Status Laporan": r.isSaved ? "Tersimpan" : "Draft",
      }));

      const worksheet = XLSX.utils.json_to_sheet(formattedData);
      // Sheet name max 31 chars in Excel
      const sheetName = (group.branchName || "Tanpa Cabang").substring(0, 31).replace(/[\\/?*[\]]/g, "_");
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    });

    // If more than 1 branch, also append a master summary sheet
    if (branchGroups.length > 1) {
      const allData = filteredReports.map((r) => ({
        "Cabang": r.branchName || "Tanpa Cabang",
        "Nama Terapis": r.therapistName,
        "Total Pasien": r.totalTreatments,
        "Kehadiran (H/T/A)": `${r.attendancePresent}/${r.attendanceLate}/${r.attendanceAbsent}`,
        "Gaji Pokok": r.baseSalary,
        "Komisi Tindakan": r.commissions,
        Tunjangan: r.allowances,
        Bonus: r.bonuses,
        Potongan: r.deductions,
        "Take Home Pay": r.takeHomePay,
        "Status Laporan": r.isSaved ? "Tersimpan" : "Draft",
      }));
      const allSheet = XLSX.utils.json_to_sheet(allData);
      XLSX.utils.book_append_sheet(workbook, allSheet, "Semua Cabang (Rekap)");
    }

    const branchLabel = selectedBranch !== "ALL" ? `_${selectedBranch}` : "";
    const fileName =
      filterMode === "month"
        ? `Rekap_Gaji_Terapis${branchLabel}_${month}.xlsx`
        : `Rekap_Gaji_Terapis${branchLabel}_${startDate}_sd_${endDate}.xlsx`;

    XLSX.writeFile(workbook, fileName);
  };

  const handleExportPDF = async () => {
    if (filteredReports.length === 0) return alert("Tidak ada data untuk diekspor");

    const { jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF("landscape");

    const periodText =
      filterMode === "month"
        ? `Periode: ${getMonthReadable(month)}`
        : `Periode: ${startDate} s/d ${endDate}`;

    const tableColumn = [
      "Nama Terapis",
      "Total Pasien",
      "Kehadiran (H/T/A)",
      "Gaji Pokok",
      "Komisi",
      "Tunjangan",
      "Bonus",
      "Potongan",
      "Take Home Pay",
      "Status",
    ];

    let currentY = 20;

    // Title
    doc.setFontSize(16);
    doc.text("Rekap Gaji Terapis - Klinik Navara Reflexology", 14, currentY);
    currentY += 8;

    doc.setFontSize(11);
    doc.text(periodText, 14, currentY);
    currentY += 10;

    // Render branch by branch to guarantee zero cross-branch confusion
    branchGroups.forEach((group, index) => {
      if (index > 0) {
        currentY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 14 : currentY + 14;
        if (currentY > 165) {
          doc.addPage();
          currentY = 20;
        }
      }

      const branchPayroll = group.reports.reduce((sum, r) => sum + r.takeHomePay, 0);

      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.text(
        `Cabang: ${group.branchName} (${group.reports.length} Terapis - Subtotal: ${formatRupiah(branchPayroll)})`,
        14,
        currentY
      );
      doc.setFont("helvetica", "normal");
      currentY += 5;

      const tableRows = group.reports.map((r) => [
        r.therapistName,
        r.totalTreatments.toString(),
        `${r.attendancePresent}/${r.attendanceLate}/${r.attendanceAbsent}`,
        formatRupiah(r.baseSalary),
        formatRupiah(r.commissions),
        formatRupiah(r.allowances),
        formatRupiah(r.bonuses),
        formatRupiah(r.deductions),
        formatRupiah(r.takeHomePay),
        r.isSaved ? "Terbit" : "Draft",
      ]);

      autoTable(doc, {
        head: [tableColumn],
        body: tableRows,
        startY: currentY,
        styles: { fontSize: 8.5 },
        headStyles: { fillColor: [13, 148, 136] }, // emerald / teal
      });
    });

    const branchLabel = selectedBranch !== "ALL" ? `_${selectedBranch}` : "";
    const fileName =
      filterMode === "month"
        ? `Rekap_Gaji_Terapis${branchLabel}_${month}.pdf`
        : `Rekap_Gaji_Terapis${branchLabel}_${startDate}_sd_${endDate}.pdf`;

    doc.save(fileName);
  };

  if (!isMounted) return null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 bg-gray-50/50 min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <PageHeader
          title="Rapor & Slip Gaji Terapis"
          description="Kelola slip gaji digital, metrik performa, dan link evaluasi privat terapis."
          icon={Award}
          rightContent={
            <div className="flex flex-col md:flex-row items-center gap-3 mt-4 md:mt-0 w-full md:w-auto">

              {/* Branch Selector (for SUPER_ADMIN / INVESTOR) */}
              {session?.role === "SUPER_ADMIN" && (
                <div className="relative">
                  <Building2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-emerald-600 pointer-events-none" />
                  <select
                    id="branch-filter-select"
                    value={selectedBranch}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedBranch(val);
                      document.cookie = `navara-selected-branch=${val}; path=/; max-age=${60 * 60 * 24 * 30}`;
                    }}
                    className="pl-9 pr-8 py-2.5 bg-white border border-gray-200 text-gray-900 rounded-xl focus:ring-2 focus:ring-emerald-500/20 text-sm outline-none cursor-pointer appearance-none transition-all font-semibold shadow-sm"
                  >
                    <option value="ALL">🏢 Semua Cabang</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        📍 {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Mode Filter Selector */}
              <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 p-1">
                <button
                  onClick={() => setFilterMode("month")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${filterMode === "month" ? "bg-blue-50 text-blue-700" : "text-gray-500 hover:text-gray-700"}`}
                >
                  Per Bulan
                </button>
                <button
                  onClick={() => setFilterMode("dateRange")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${filterMode === "dateRange" ? "bg-blue-50 text-blue-700" : "text-gray-500 hover:text-gray-700"}`}
                >
                  Rentang Tanggal
                </button>
              </div>

              {filterMode === "month" ? (
                <div className="relative">
                  <Calendar className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    id="report-month-picker"
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    className="pl-9 pr-4 py-2.5 bg-white border border-gray-200 text-gray-900 rounded-xl focus:ring-2 focus:ring-blue-500/20 text-sm outline-none cursor-pointer w-full sm:w-auto transition-all"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="px-3 py-2.5 bg-white border border-gray-200 text-gray-900 rounded-xl focus:ring-2 focus:ring-blue-500/20 text-sm outline-none cursor-pointer w-full sm:w-36 transition-all"
                    />
                  </div>
                  <span className="text-gray-400 text-sm">s/d</span>
                  <div className="relative">
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="px-3 py-2.5 bg-white border border-gray-200 text-gray-900 rounded-xl focus:ring-2 focus:ring-blue-500/20 text-sm outline-none cursor-pointer w-full sm:w-36 transition-all"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportPDF}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-xl transition-all shadow-sm shadow-red-600/20"
                >
                  <FileText className="w-4 h-4" />
                  Export PDF
                </button>
                <button
                  onClick={handleExportExcel}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all shadow-sm shadow-blue-600/20"
                >
                  <Table className="w-4 h-4" />
                  Export Excel
                </button>
                {session?.role === "SUPER_ADMIN" && (
                  <button
                    onClick={async () => {
                      if (
                        !confirm(
                          "Apakah Anda yakin ingin memperbaiki dan mensinkronisasi ulang seluruh komisi terapis?",
                        )
                      )
                        return;
                      try {
                        const res = await fetch("/api/recalculate-commissions", { method: "POST" });
                        const data = await res.json();
                        if (data.success) {
                          alert(data.message);
                          fetchReports(month, startDate, endDate);
                        } else {
                          alert(data.error || "Gagal sinkronisasi");
                        }
                      } catch (e) {
                        alert("Terjadi kesalahan sistem");
                      }
                    }}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-xl transition-all shadow-sm shadow-emerald-500/10 border border-emerald-200"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Sync Komisi
                  </button>
                )}
              </div>

              <button
                id="bulk-save-btn"
                onClick={handleBulkSave}
                disabled={
                  loading ||
                  bulking ||
                  filteredReports.filter((r) => !r.isSaved).length === 0
                }
                className="bg-white text-indigo-900 hover:bg-gray-50 disabled:bg-gray-200 disabled:text-gray-500 px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-black/10 transition-all cursor-pointer text-sm"
              >
                {bulking ? (
                  <div className="w-4 h-4 border-2 border-indigo-900/30 border-t-indigo-900 rounded-full animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                Simpan Semua Draft (
                {filteredReports.filter((r) => !r.isSaved).length})
              </button>
            </div>
          }
        />

        {/* Message Alert */}
        {message && (
          <div
            className={`mb-6 p-4 rounded-xl border flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300 ${message.type === "success" ? "bg-blue-50 border-blue-200 text-blue-800" : "bg-red-50 border-red-200 text-red-800"}`}
          >
            {message.type === "success" ? (
              <CheckCircle className="w-5 h-5 text-blue-600 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            )}
            <span className="text-sm font-semibold">{message.text}</span>
          </div>
        )}

        {/* Dashboard Cards Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
          <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
              <User className="w-5.5 h-5.5" />
            </div>
            <div>
              <p className="text-gray-400 text-[10px] font-bold uppercase tracking-wider">
                Total Terapis
              </p>
              <h4 className="text-lg font-black text-gray-900 mt-0.5">
                {filteredReports.length} Pegawai
              </h4>
            </div>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
              <CheckCircle className="w-5.5 h-5.5" />
            </div>
            <div>
              <p className="text-gray-400 text-[10px] font-bold uppercase tracking-wider">
                Rapor Tersimpan
              </p>
              <h4 className="text-lg font-black text-gray-900 mt-0.5">
                {filteredReports.filter((r) => r.isSaved).length} Terbit
              </h4>
            </div>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 shrink-0">
              <AlertTriangle className="w-5.5 h-5.5" />
            </div>
            <div>
              <p className="text-gray-400 text-[10px] font-bold uppercase tracking-wider">
                Draft / Belum Disimpan
              </p>
              <h4 className="text-lg font-black text-gray-900 mt-0.5">
                {filteredReports.filter((r) => !r.isSaved).length} Draft
              </h4>
            </div>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
              <DollarSign className="w-5.5 h-5.5" />
            </div>
            <div>
              <p className="text-gray-400 text-[10px] font-bold uppercase tracking-wider">
                Estimasi Total Payroll
              </p>
              <h4 className="text-lg font-black text-gray-900 mt-0.5">
                {formatRupiah(
                  filteredReports.reduce((sum, r) => sum + r.takeHomePay, 0),
                )}
              </h4>
            </div>
          </div>
        </div>

        {/* Main Grid List — Grouped by Branch */}
        {loading ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden relative">
            <div className="px-6 py-16 text-center text-gray-400">
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                Mempersiapkan data rapor bulanan...
              </div>
            </div>
          </div>
        ) : branchGroups.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden relative">
            <div className="px-6 py-16 text-center text-gray-500">
              Tidak ada terapis aktif untuk periode ini.
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {branchGroups.map((group) => {
              const branchSaved = group.reports.filter((r) => r.isSaved).length;
              const branchDraft = group.reports.filter((r) => !r.isSaved).length;
              const branchPayroll = group.reports.reduce((sum, r) => sum + r.takeHomePay, 0);

              return (
                <div key={group.branchId} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden relative">
                  {/* Branch Section Header */}
                  <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shadow-inner">
                        <Building2 className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-white font-black text-base">{group.branchName}</h3>
                          <span className="bg-white/20 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                            Cabang Terisolasi
                          </span>
                        </div>
                        <p className="text-emerald-100 text-xs font-medium">
                          {group.reports.length} Terapis • {branchSaved} Rapor Terbit • {branchDraft} Draft Belum Simpan
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {branchDraft > 0 && (
                        <button
                          onClick={() => handleBulkSave(group.reports)}
                          disabled={bulking}
                          className="bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-3 py-1.5 rounded-lg border border-white/30 flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                          title={`Simpan ${branchDraft} draft laporan di cabang ${group.branchName}`}
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          Simpan {branchDraft} Draft Cabang Ini
                        </button>
                      )}
                      <div className="text-right">
                        <p className="text-emerald-100 text-[10px] font-bold uppercase tracking-wider">Subtotal Payroll</p>
                        <p className="text-white font-black text-base">{formatRupiah(branchPayroll)}</p>
                      </div>
                    </div>
                  </div>

                  {/* Branch Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse whitespace-nowrap">
                      <thead>
                        <tr className="bg-gray-50/50 text-xs uppercase tracking-wider text-gray-500 border-b border-gray-100">
                          <th className="px-6 py-3 font-bold">Terapis</th>
                          <th className="px-6 py-3 font-bold text-center">Status Rapor</th>
                          <th className="px-6 py-3 font-bold text-center">Treatment</th>
                          <th className="px-6 py-3 font-bold text-center">Kehadiran (H / T / A)</th>
                          <th className="px-6 py-3 font-bold text-right">Gaji Pokok</th>
                          <th className="px-6 py-3 font-bold text-right">Komisi Tindakan</th>
                          <th className="px-6 py-3 font-bold text-right">Take-Home Pay (THP)</th>
                          <th className="px-6 py-3 font-bold text-center">Aksi Distribusi & Rapor</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {group.reports.map((r) => (
                          <tr
                            key={r.therapistId}
                            className="hover:bg-blue-50/10 transition-colors"
                          >
                            <td className="px-6 py-4 font-bold text-gray-900">
                              <div>{r.therapistName}</div>
                              <div className="text-[10px] text-gray-400 mt-0.5 uppercase tracking-wide">
                                ID: {r.therapistId?.substring(0, 8) || "N/A"}...
                              </div>
                            </td>
                            <td className="px-6 py-4 text-center">
                              {r.isSaved ? (
                                <span className="inline-flex px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wide uppercase bg-blue-50 text-blue-700 border border-blue-200">
                                  Telah Terbit
                                </span>
                              ) : (
                                <span className="inline-flex px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wide uppercase bg-yellow-50 text-yellow-700 border border-yellow-200 animate-pulse">
                                  Draft (Belum Simpan)
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-center font-bold text-gray-800">
                              {r.totalTreatments} Pasien
                            </td>
                            <td className="px-6 py-4 text-center font-semibold text-sm text-gray-600">
                              <span className="text-blue-600 font-bold">
                                {r.attendancePresent}
                              </span>
                              {" / "}
                              <span className="text-amber-500 font-bold">
                                {r.attendanceLate}
                              </span>
                              {" / "}
                              <span className="text-red-500 font-bold">
                                {r.attendanceAbsent}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right text-gray-600 font-medium">
                              {formatRupiah(r.baseSalary)}
                            </td>
                            <td className="px-6 py-4 text-right text-blue-600 font-semibold">
                              +{formatRupiah(r.commissions)}
                            </td>
                            <td className="px-6 py-4 text-right font-black text-gray-900">
                              {formatRupiah(r.takeHomePay)}
                            </td>
                            <td className="px-6 py-4 text-center">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  onClick={() => handleEditClick(r)}
                                  className="bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border border-blue-100"
                                >
                                  <Edit className="w-3.5 h-3.5" />
                                  Kelola Rapor
                                </button>

                                <button
                                  disabled={!r.isSaved}
                                  onClick={() => handleDownloadSlipPDF(r)}
                                  className="bg-gray-50 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 px-2 py-1.5 rounded-lg border border-gray-200 transition-colors"
                                  title="Download Slip Gaji (PDF)"
                                >
                                  <FileText className="w-3.5 h-3.5" />
                                </button>

                                <button
                                  disabled={!r.isSaved}
                                  onClick={() => handleSendWA(r)}
                                  className="bg-blue-50 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed text-blue-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 border border-blue-100 cursor-pointer"
                                  title="Kirim slip gaji privat ke WhatsApp Terapis"
                                >
                                  <Send className="w-3.5 h-3.5" />
                                  Kirim WA
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Modal Kelola Rapor */}
        {isModalOpen && activeReport && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <div>
                  <h3 className="text-lg font-black text-gray-800">
                    Kelola Rapor & Gaji Bulanan
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Terapis:{" "}
                    <span className="font-bold text-gray-700">
                      {activeReport.therapistName}
                    </span>{" "}
                    | Cabang:{" "}
                    <span className="font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                      {activeReport.branchName || "Tanpa Cabang"}
                    </span>{" "}
                    | Periode:{" "}
                    <span className="font-bold text-gray-700">
                      {getPeriodLabel(activeReport)}
                    </span>
                  </p>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
                >
                  ✕
                </button>
              </div>

              {/* Modal Body Form */}
              <form
                onSubmit={handleSaveReport}
                className="flex-1 overflow-y-auto custom-scrollbar"
              >
                <div className="p-6 space-y-6">
                  {/* Row 1: Kuantitatif Performa */}
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-blue-500" /> Modul 1:
                      Metrik Performa & Kehadiran
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 bg-gray-50/60 p-4 rounded-xl border border-gray-100">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-500 uppercase">
                          Total Tindakan
                        </label>
                        <input
                          type="number"
                          required
                          min="0"
                          value={activeReport.totalTreatments}
                          onChange={(e) =>
                            handleModalInputChange(
                              "totalTreatments",
                              parseInt(e.target.value) || 0,
                            )
                          }
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-500 uppercase text-blue-600">
                          Kehadiran (Hadir)
                        </label>
                        <input
                          type="number"
                          required
                          min="0"
                          value={activeReport.attendancePresent}
                          onChange={(e) =>
                            handleModalInputChange(
                              "attendancePresent",
                              parseInt(e.target.value) || 0,
                            )
                          }
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold text-blue-700 outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-500 uppercase text-amber-500">
                          Terlambat
                        </label>
                        <input
                          type="number"
                          required
                          min="0"
                          value={activeReport.attendanceLate}
                          onChange={(e) =>
                            handleModalInputChange(
                              "attendanceLate",
                              parseInt(e.target.value) || 0,
                            )
                          }
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold text-amber-600 outline-none focus:ring-2 focus:ring-amber-500/20"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-500 uppercase text-red-500">
                          Absen (Mangkir)
                        </label>
                        <input
                          type="number"
                          required
                          min="0"
                          value={activeReport.attendanceAbsent}
                          onChange={(e) =>
                            handleModalInputChange(
                              "attendanceAbsent",
                              parseInt(e.target.value) || 0,
                            )
                          }
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold text-red-700 outline-none focus:ring-2 focus:ring-red-500/20"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-500 uppercase text-purple-600">
                          Sakit / Izin
                        </label>
                        <input
                          type="number"
                          required
                          min="0"
                          value={activeReport.attendancePermit}
                          onChange={(e) =>
                            handleModalInputChange(
                              "attendancePermit",
                              parseInt(e.target.value) || 0,
                            )
                          }
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold text-purple-700 outline-none focus:ring-2 focus:ring-purple-500/20"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Row 2: Keuangan / Slip Gaji */}
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-blue-500" /> Modul 2:
                      Slip Gaji Komponen
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-gray-50/60 p-4 rounded-xl border border-gray-100">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-500 uppercase">
                          Gaji Pokok (Rp)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={activeReport.baseSalary}
                          onChange={(e) =>
                            handleModalInputChange(
                              "baseSalary",
                              parseInt(e.target.value) || 0,
                            )
                          }
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-500 uppercase">
                          Komisi Tindakan (Rp)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={activeReport.commissions}
                          onChange={(e) =>
                            handleModalInputChange(
                              "commissions",
                              parseInt(e.target.value) || 0,
                            )
                          }
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-500 uppercase">
                          Tunjangan Makan / Transport (Rp)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={activeReport.allowances}
                          onChange={(e) =>
                            handleModalInputChange(
                              "allowances",
                              parseInt(e.target.value) || 0,
                            )
                          }
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-500 uppercase">
                          Bonus / Insentif Target (Rp)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={activeReport.bonuses}
                          onChange={(e) =>
                            handleModalInputChange(
                              "bonuses",
                              parseInt(e.target.value) || 0,
                            )
                          }
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-500 uppercase text-red-500">
                          Potongan / Kasbon / Denda (Rp)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={activeReport.deductions}
                          onChange={(e) =>
                            handleModalInputChange(
                              "deductions",
                              parseInt(e.target.value) || 0,
                            )
                          }
                          className="w-full px-3 py-2 bg-white border border-red-200 rounded-lg text-sm font-semibold text-red-600 outline-none focus:ring-2 focus:ring-red-500/20"
                        />
                      </div>

                      {/* Take-home Pay Display */}
                      <div className="space-y-1 bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-lg p-3 sm:col-span-1 shadow-sm">
                        <label className="text-[9px] font-bold text-blue-100 uppercase tracking-wide">
                          Net Take-Home Pay (THP)
                        </label>
                        <div className="text-lg font-black mt-0.5">
                          {formatRupiah(activeReport.takeHomePay)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Row 3: Evaluasi Kualitatif & Rating */}
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-purple-500" /> Modul
                        3: Evaluasi Kualitatif & Feedback
                      </h4>
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold text-gray-500 uppercase">
                          Rating Kinerja:
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="Cth: 4.8"
                          value={activeReport.rating}
                          onChange={(e) =>
                            handleModalInputChange("rating", e.target.value)
                          }
                          className="w-16 px-2 py-1 bg-white border border-gray-200 rounded-lg text-xs font-bold text-center outline-none focus:ring-2 focus:ring-purple-500/20"
                        />
                      </div>
                    </div>

                    <div className="space-y-3 bg-gray-50/60 p-4 rounded-xl border border-gray-100">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-600 uppercase">
                          Kelebihan Bulan Ini (Apresiasi)
                        </label>
                        <textarea
                          rows={2}
                          value={activeReport.notesStrengths}
                          onChange={(e) =>
                            handleModalInputChange(
                              "notesStrengths",
                              e.target.value,
                            )
                          }
                          placeholder="Tuliskan aspek positif kinerja terapis..."
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-purple-500/20 transition-all"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-600 uppercase">
                          Area Perbaikan (Kritik / Catatan SOP)
                        </label>
                        <textarea
                          rows={2}
                          value={activeReport.notesImprovements}
                          onChange={(e) =>
                            handleModalInputChange(
                              "notesImprovements",
                              e.target.value,
                            )
                          }
                          placeholder="Aspek standar pelayanan atau kedisiplinan yang perlu diperbaiki..."
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-purple-500/20 transition-all"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-600 uppercase">
                          Target Bulan Depan
                        </label>
                        <textarea
                          rows={2}
                          value={activeReport.notesTargets}
                          onChange={(e) =>
                            handleModalInputChange(
                              "notesTargets",
                              e.target.value,
                            )
                          }
                          placeholder="Instruksi spesifik target pencapaian bulan depan..."
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-purple-500/20 transition-all"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Modal Footer actions */}
                <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-5 py-2.5 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-xl flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
                  >
                    {saving ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    {saving ? "Menyimpan..." : "Simpan Laporan & Slip"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
