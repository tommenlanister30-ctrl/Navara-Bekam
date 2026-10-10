"use client";

import { useState, useEffect } from "react";
import { Receipt, Calendar as CalendarIcon, CheckCircle, Search, User, Download, Undo2, FileText } from "lucide-react";
import PageHeader from "@/components/layout/PageHeader";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export default function AdminStaffPayrollPage() {
  const [staffList, setStaffList] = useState<any[]>([]);
  const [payrolls, setPayrolls] = useState<any[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [loading, setLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [selectedStaffForPayroll, setSelectedStaffForPayroll] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [undoModalOpen, setUndoModalOpen] = useState(false);
  const [undoTarget, setUndoTarget] = useState<any>(null);
  const [isUndoing, setIsUndoing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  
  const [payrollForm, setPayrollForm] = useState({
    attendancePresent: 20,
    attendanceLate: 0,
    attendanceAbsent: 0,
    baseSalary: 0,
    allowances: 0,
    bonuses: 0,
    deductions: 0,
    notes: "",
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [resStaff, resPayrolls, sessionRes] = await Promise.all([
        fetch("/api/staff"),
        fetch(`/api/staff-payroll?month=${selectedMonth}`),
        fetch("/api/auth/session")
      ]);
      if (resStaff.ok) {
        const staffData = await resStaff.json();
        setStaffList(staffData.data || []);
      }
      if (resPayrolls.ok) {
        const payrollData = await resPayrolls.json();
        setPayrolls(payrollData.data || []);
      }
      if (sessionRes.ok) {
        const sJson = await sessionRes.json();
        setSession(sJson.session);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedMonth]);

  const handleOpenGenerate = (staff: any) => {
    setSelectedStaffForPayroll(staff);
    const allowances = staff.dailyAllowance * 20; // Default 20 days present
    setPayrollForm({
      attendancePresent: 20,
      attendanceLate: 0,
      attendanceAbsent: 0,
      baseSalary: staff.baseSalary,
      allowances: allowances,
      bonuses: 0,
      deductions: 0,
      notes: "",
    });
    setGenerateModalOpen(true);
  };

  const handleGeneratePayroll = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsGenerating(true);
    try {
      await fetch("/api/staff-payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: selectedStaffForPayroll.id,
          month: selectedMonth,
          ...payrollForm
        })
      });
      setGenerateModalOpen(false);
      fetchData();
    } catch (err) {
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const calculateTakeHomePay = () => {
    return (
      (payrollForm.baseSalary || 0) +
      (payrollForm.allowances || 0) +
      (payrollForm.bonuses || 0) -
      (payrollForm.deductions || 0)
    );
  };

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(val);
  };

  const generateSlipPage = (doc: any, payrollData: any, isFirst: boolean) => {
    const { report, staff } = payrollData;
    if (!isFirst) doc.addPage();

    doc.setFontSize(20);
    doc.text("NAVARA REFLEXOLOGY", 105, 20, { align: "center" });
    
    doc.setFontSize(14);
    doc.text("SLIP GAJI PEGAWAI", 105, 30, { align: "center" });
    
    doc.setFontSize(10);
    doc.text(`Periode: ${report.month}`, 105, 38, { align: "center" });

    doc.line(14, 45, 196, 45);

    doc.setFontSize(11);
    doc.text(`Nama Pegawai: ${staff.name}`, 14, 55);
    doc.text(`Jabatan: ${staff.role}`, 14, 62);
    
    doc.text(`Kehadiran:`, 120, 55);
    doc.text(`- Hadir: ${report.attendancePresent} Hari`, 125, 62);
    doc.text(`- Terlambat: ${report.attendanceLate} Hari`, 125, 69);
    doc.text(`- Absen: ${report.attendanceAbsent} Hari`, 125, 76);

    autoTable(doc, {
      startY: 85,
      head: [["Keterangan", "Nominal"]],
      body: [
        ["Gaji Pokok", formatRupiah(report.baseSalary)],
        ["Uang Makan/Transport", formatRupiah(report.allowances)],
        ["Bonus / THR", formatRupiah(report.bonuses)],
        ["Potongan / Kasbon", `(${formatRupiah(report.deductions)})`],
      ],
      foot: [["Take Home Pay", formatRupiah(report.takeHomePay)]],
      theme: "grid",
      headStyles: { fillColor: [41, 128, 185] },
      footStyles: { fillColor: [46, 204, 113], textColor: [255, 255, 255] }
    });

    if (report.notes) {
      const finalY = (doc as any).lastAutoTable.finalY + 10;
      doc.text(`Catatan: ${report.notes}`, 14, finalY);
    }
  };

  const handlePrintSlip = (payrollData: any) => {
    const doc = new jsPDF();
    generateSlipPage(doc, payrollData, true);
    doc.save(`Slip_Gaji_${payrollData.staff.name}_${payrollData.report.month}.pdf`);
  };

  const handleExportAllPDF = () => {
    if (payrolls.length === 0) return;
    setIsExporting(true);
    try {
      const doc = new jsPDF();
      payrolls.forEach((payrollData, index) => {
        generateSlipPage(doc, payrollData, index === 0);
      });
      doc.save(`Slip_Gaji_Semua_Staff_${selectedMonth}.pdf`);
    } catch (err) {
      console.error(err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleOpenUndo = (payrollData: any) => {
    setUndoTarget(payrollData);
    setUndoModalOpen(true);
  };

  const handleUndoPayroll = async () => {
    if (!undoTarget) return;
    setIsUndoing(true);
    try {
      const res = await fetch(`/api/staff-payroll?id=${undoTarget.report.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setUndoModalOpen(false);
        setUndoTarget(null);
        fetchData();
      } else {
        const data = await res.json();
        alert(data.error || "Gagal menghapus slip gaji");
      }
    } catch (err) {
      console.error(err);
      alert("Terjadi kesalahan saat menghapus slip gaji");
    } finally {
      setIsUndoing(false);
    }
  };

  const getStaffPayrollReport = (staffId: string) => {
    return payrolls.find(p => p.report.staffId === staffId);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <PageHeader 
          title="Slip Gaji Manajemen"
          description="Kelola dan cetak slip gaji untuk Staff Non-Terapis / Manajemen."
          icon={Receipt}
          rightContent={
            <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto mt-4 md:mt-0">
              <button
                onClick={handleExportAllPDF}
                disabled={payrolls.length === 0 || isExporting}
                className="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 text-emerald-100 rounded-xl text-sm font-bold inline-flex items-center gap-2 backdrop-blur-md transition-all disabled:opacity-40 disabled:cursor-not-allowed w-full sm:w-auto justify-center"
              >
                <FileText className="w-4 h-4" />
                {isExporting ? "Mengekspor..." : "Export PDF"}
              </button>
              <input 
                type="month" 
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="px-4 py-2 bg-white/10 border border-white/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-white/50 text-white text-sm backdrop-blur-md transition-all w-full sm:w-auto"
              />
            </div>
          }
        />

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mt-6">
          {loading ? (
            <div className="text-center py-12 text-gray-500">Memuat data penggajian...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-xs font-bold text-gray-500 uppercase">
                    <th className="px-6 py-4">Nama Staff & Jabatan</th>
                    <th className="px-6 py-4">Gaji Pokok</th>
                    <th className="px-6 py-4 text-center">Status Gaji</th>
                    <th className="px-6 py-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {staffList.filter(s => s.isActive).map(staff => {
                    const reportData = getStaffPayrollReport(staff.id);
                    
                    return (
                      <tr key={staff.id} className="hover:bg-gray-50/50">
                        <td className="px-6 py-4">
                          <div className="font-bold text-gray-900">{staff.name}</div>
                          <div className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded w-max mt-1">{staff.role}</div>
                        </td>
                        <td className="px-6 py-4 text-gray-700 font-medium">
                          {formatRupiah(staff.baseSalary)}
                        </td>
                        <td className="px-6 py-4 text-center">
                          {reportData ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700">
                              <CheckCircle className="w-3.5 h-3.5" /> Sudah Dibuat
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
                              Belum Dibuat
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          {reportData ? (
                            <div className="flex items-center gap-2 justify-end">
                              <button
                                onClick={() => handlePrintSlip(reportData)}
                                className="bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-2 rounded-lg text-sm font-bold inline-flex items-center gap-2"
                              >
                                <Download className="w-4 h-4" /> Cetak Slip
                              </button>
                              <button
                                onClick={() => handleOpenUndo(reportData)}
                                className="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-2 rounded-lg text-sm font-bold inline-flex items-center gap-2"
                                title="Undo / Hapus Slip Gaji"
                              >
                                <Undo2 className="w-4 h-4" /> Undo
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleOpenGenerate(staff)}
                              className="bg-primary hover:bg-indigo-700 text-white px-3 py-2 rounded-lg text-sm font-bold inline-flex items-center gap-2"
                            >
                              <Receipt className="w-4 h-4" /> Buat Slip Gaji
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Generate Modal */}
        {generateModalOpen && selectedStaffForPayroll && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setGenerateModalOpen(false)}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="shrink-0 bg-gradient-to-r from-blue-900 to-indigo-900 p-6 text-white flex justify-between items-center shadow-md">
                <div>
                  <h3 className="text-xl font-extrabold">Buat Slip Gaji: {selectedStaffForPayroll.name}</h3>
                  <p className="text-blue-200 text-xs mt-1">Periode: {selectedMonth}</p>
                </div>
              </div>

              <div className="overflow-y-auto custom-scrollbar flex-1 p-6">
                <form onSubmit={handleGeneratePayroll} className="space-y-6">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-700">Kehadiran (Hari)</label>
                      <input type="number" value={payrollForm.attendancePresent} onChange={e => {
                        const days = parseInt(e.target.value) || 0;
                        setPayrollForm({...payrollForm, attendancePresent: days, allowances: days * selectedStaffForPayroll.dailyAllowance});
                      }} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/20" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-700">Terlambat (Hari)</label>
                      <input type="number" value={payrollForm.attendanceLate} onChange={e => setPayrollForm({...payrollForm, attendanceLate: parseInt(e.target.value) || 0})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/20" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-700">Absen/Alpa (Hari)</label>
                      <input type="number" value={payrollForm.attendanceAbsent} onChange={e => setPayrollForm({...payrollForm, attendanceAbsent: parseInt(e.target.value) || 0})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/20" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-700">Gaji Pokok (Rp)</label>
                      <input type="number" value={payrollForm.baseSalary} onChange={e => setPayrollForm({...payrollForm, baseSalary: parseInt(e.target.value) || 0})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/20" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-700">Uang Makan/Transport Total (Rp)</label>
                      <input type="number" value={payrollForm.allowances} onChange={e => setPayrollForm({...payrollForm, allowances: parseInt(e.target.value) || 0})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/20" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-700">Bonus/THR (Rp)</label>
                      <input type="number" value={payrollForm.bonuses} onChange={e => setPayrollForm({...payrollForm, bonuses: parseInt(e.target.value) || 0})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/20" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-700 text-red-600">Potongan/Kasbon (Rp)</label>
                      <input type="number" value={payrollForm.deductions} onChange={e => setPayrollForm({...payrollForm, deductions: parseInt(e.target.value) || 0})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500/20" />
                    </div>
                  </div>

                  <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl flex justify-between items-center">
                    <span className="font-bold text-indigo-900">Total Take Home Pay:</span>
                    <span className="text-2xl font-black text-indigo-700">{formatRupiah(calculateTakeHomePay())}</span>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-700">Catatan (Opsional)</label>
                    <textarea value={payrollForm.notes} onChange={e => setPayrollForm({...payrollForm, notes: e.target.value})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary/20" rows={2}></textarea>
                  </div>

                  <div className="flex gap-4 justify-end pt-4">
                    <button type="button" onClick={() => setGenerateModalOpen(false)} className="px-6 py-2 rounded-lg text-gray-600 font-bold">Batal</button>
                    <button type="submit" disabled={isGenerating} className="bg-primary text-white px-8 py-2 rounded-lg font-bold flex items-center gap-2">
                      {isGenerating ? "Menyimpan..." : "Simpan Slip Gaji"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Undo Confirmation Modal */}
        {undoModalOpen && undoTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setUndoModalOpen(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="bg-gradient-to-r from-red-600 to-red-700 p-5 text-white">
                <h3 className="text-lg font-extrabold flex items-center gap-2">
                  <Undo2 className="w-5 h-5" /> Undo Slip Gaji
                </h3>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-gray-700 text-sm">
                  Apakah Anda yakin ingin menghapus slip gaji <span className="font-bold text-gray-900">{undoTarget.staff?.name}</span> untuk periode <span className="font-bold text-gray-900">{undoTarget.report?.month}</span>?
                </p>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs text-amber-800 font-medium">
                    ⚠️ Data slip gaji akan dihapus dan status akan kembali ke "Belum Dibuat". Anda bisa membuat ulang slip gaji setelahnya.
                  </p>
                </div>
                <div className="flex gap-3 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setUndoModalOpen(false)}
                    className="px-5 py-2 rounded-lg text-gray-600 font-bold hover:bg-gray-100 transition-colors"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={handleUndoPayroll}
                    disabled={isUndoing}
                    className="bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-lg font-bold inline-flex items-center gap-2 transition-colors disabled:opacity-50"
                  >
                    {isUndoing ? "Menghapus..." : "Ya, Hapus Slip"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
