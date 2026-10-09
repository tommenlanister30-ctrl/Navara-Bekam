import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { financeTransactions, patientVisits, monthlyTargets, therapists } from "@/lib/db/schema";
import { sql, eq, and, gte, lt } from "drizzle-orm";
import { getSession, getActiveBranchFilter } from "@/lib/auth";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month") || (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    })();

    const [yearStr, mthStr] = month.split('-');
    const year = parseInt(yearStr, 10);
    const mth = parseInt(mthStr, 10);
    const monthStart = `${month}-01`;
    let nextYear = year;
    let nextMonth = mth + 1;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    const monthEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "API Key Gemini tidak ditemukan di environment variables (.env). Mohon tambahkan GEMINI_API_KEY." },
        { status: 500 }
      );
    }

    let branchFilter = await getActiveBranchFilter();
    if (branchFilter === "ALL") branchFilter = null;

    // 1. Ambil Data Finansial Bulan Ini
    let monthFinanceQuery = db
      .select({
        type: financeTransactions.type,
        totalAmount: sql<number>`SUM(${financeTransactions.amount})`
      })
      .from(financeTransactions);

    const dateCondition = and(
      gte(financeTransactions.date, monthStart),
      lt(financeTransactions.date, monthEnd)
    );
    if (branchFilter) {
      monthFinanceQuery = monthFinanceQuery.where(and(dateCondition, eq(financeTransactions.branchId, branchFilter))) as any;
    } else {
      monthFinanceQuery = monthFinanceQuery.where(dateCondition) as any;
    }

    const monthFinance = await monthFinanceQuery.groupBy(financeTransactions.type);
    let monthIncome = 0;
    let monthExpense = 0;

    for (const row of monthFinance) {
      if (row.type === "INCOME") monthIncome = row.totalAmount;
      if (row.type === "EXPENSE") monthExpense = row.totalAmount;
    }

    // 2. Ambil Target Bulanan
    const targetCondition = branchFilter
      ? and(eq(monthlyTargets.month, month), eq(monthlyTargets.branchId, branchFilter))
      : eq(monthlyTargets.month, month);
    const targets = await db.select().from(monthlyTargets).where(targetCondition);
    
    let totalTargetIncome = 0;
    let totalTargetVisits = 0;
    for (const t of targets) {
      totalTargetIncome += t.targetIncome;
      totalTargetVisits += t.targetVisits;
    }

    // 3. Ambil Kedatangan Pasien (Kunjungan) Bulan Ini
    let visitsQuery = db
      .select({ count: sql<number>`COUNT(${patientVisits.id})` })
      .from(patientVisits);
      
    const visitDateCondition = and(
      gte(patientVisits.visitDate, monthStart),
      lt(patientVisits.visitDate, monthEnd)
    );
    if (branchFilter) {
      visitsQuery = visitsQuery.where(and(visitDateCondition, eq(patientVisits.branchId, branchFilter))) as any;
    } else {
      visitsQuery = visitsQuery.where(visitDateCondition) as any;
    }
    const visits = await visitsQuery;
    const actualVisits = visits[0]?.count || 0;

    // 4. Ambil Performa Terapis
    let therapistQuery = db
      .select({
        therapistName: therapists.name,
        treatmentCount: sql<number>`COUNT(${patientVisits.id})`
      })
      .from(patientVisits)
      .innerJoin(therapists, eq(patientVisits.therapistId, therapists.id))
      .groupBy(therapists.id)
      .orderBy(sql`COUNT(${patientVisits.id}) DESC`)
      .limit(5);

    if (branchFilter) {
      therapistQuery = therapistQuery.where(and(visitDateCondition, eq(patientVisits.branchId, branchFilter))) as any;
    } else {
      therapistQuery = therapistQuery.where(visitDateCondition) as any;
    }

    const therapistStats = await therapistQuery;

    // Format Data untuk Prompt
    const dataContext = `
Data Performa Cabang Klinik (Bulan: ${month}):
1. Keuangan:
   - Target Omzet: Rp ${totalTargetIncome.toLocaleString('id-ID')}
   - Omzet Aktual: Rp ${monthIncome.toLocaleString('id-ID')} (${totalTargetIncome > 0 ? Math.round((monthIncome/totalTargetIncome)*100) : 0}% dari target)
   - Total Pengeluaran: Rp ${monthExpense.toLocaleString('id-ID')}
   - Laba Bersih Sementara: Rp ${(monthIncome - monthExpense).toLocaleString('id-ID')}

2. Kunjungan Pasien:
   - Target Kunjungan: ${totalTargetVisits} orang
   - Kedatangan Aktual: ${actualVisits} orang (${totalTargetVisits > 0 ? Math.round((actualVisits/totalTargetVisits)*100) : 0}% dari target)

3. Performa Terapis Terbaik (Top 5 berdasarkan jumlah treatment bulan ini):
${therapistStats.length > 0 ? therapistStats.map((t: any) => `   - ${t.therapistName}: melayani ${t.treatmentCount} pasien`).join('\n') : "   - Belum ada data treatment untuk bulan ini."}
`;

    const prompt = `
Anda adalah seorang Konsultan Bisnis Klinis dan Data Analyst profesional.
Tugas Anda adalah menganalisa data performa klinik refleksi dan bekam berikut ini.

${dataContext}

Berdasarkan data di atas, berikan:
1. Ringkasan Eksekutif (Singkat, mengevaluasi pencapaian target keuangan dan kunjungan).
2. Analisa Pengeluaran & Laba (Apakah pengeluaran tergolong sehat dibandingkan omzet?).
3. Evaluasi Performa Terapis (Sebutkan siapa yang performanya paling baik dan apa dampaknya).
4. Rekomendasi Strategis (Berikan 3 saran actionable yang spesifik untuk meningkatkan omzet dan kunjungan di bulan berikutnya).

Gunakan bahasa Indonesia yang profesional namun ramah (bisa gunakan emoji secukupnya agar menarik dibaca). 
Format output menggunakan standar Markdown.
`;

    // 5. Kirim ke Gemini AI
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const result = await model.generateContent(prompt);
    const aiResponse = result.response.text();

    return NextResponse.json({
      success: true,
      data: aiResponse
    });

  } catch (error) {
    console.error("AI Analysis API error:", error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `Gagal memproses analisa AI: ${errMsg}. Pastikan API Key valid.` },
      { status: 500 }
    );
  }
}
