import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { monthlyTargets, financeTransactions, patientVisits } from "@/lib/db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { getActiveBranchFilter, getSession } from "@/lib/auth";

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    let monthStr = searchParams.get("month");

    if (!monthStr) {
      const now = new Date();
      monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    const [year, month] = monthStr.split("-").map(Number);
    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json({ error: "Invalid month format. Use YYYY-MM" }, { status: 400 });
    }

    const numDays = getDaysInMonth(year, month);
    const startDate = `${monthStr}-01`;
    const endDate = `${monthStr}-${String(numDays).padStart(2, '0')}`;

    let branchFilter = await getActiveBranchFilter();
    if (branchFilter === "ALL") branchFilter = null;

    // 1. Fetch Target
    let targetIncome = 0;
    let targetVisits = 0;

    if (branchFilter) {
      const targets = await db
        .select()
        .from(monthlyTargets)
        .where(and(eq(monthlyTargets.month, monthStr), eq(monthlyTargets.branchId, branchFilter)));
      
      if (targets.length > 0) {
        targetIncome = targets[0].targetIncome;
        targetVisits = targets[0].targetVisits;
      }
    } else {
      // Sum all branches
      const targets = await db
        .select()
        .from(monthlyTargets)
        .where(eq(monthlyTargets.month, monthStr));
      
      targets.forEach(t => {
        targetIncome += t.targetIncome;
        targetVisits += t.targetVisits;
      });
    }

    const dailyTargetIncome = targetIncome / numDays;
    const dailyTargetVisits = targetVisits / numDays;

    // 2. Fetch Actual Income
    let incomeConditions = [
      eq(financeTransactions.type, "INCOME"),
      gte(financeTransactions.date, startDate + "T00:00:00.000Z"),
      lte(financeTransactions.date, endDate + "T23:59:59.999Z")
    ];

    if (branchFilter) {
      incomeConditions.push(eq(financeTransactions.branchId, branchFilter));
    }

    const incomes = await db
      .select()
      .from(financeTransactions)
      .where(and(...incomeConditions));

    // Group income by YYYY-MM-DD
    const incomeByDate: Record<string, number> = {};
    incomes.forEach(inc => {
      const d = inc.date.split("T")[0]; // YYYY-MM-DD
      incomeByDate[d] = (incomeByDate[d] || 0) + inc.amount;
    });

    // 3. Fetch Actual Visits
    let visitConditions = [
      eq(patientVisits.status, "completed"),
      gte(patientVisits.visitDate, startDate),
      lte(patientVisits.visitDate, endDate)
    ];

    if (branchFilter) {
      visitConditions.push(eq(patientVisits.branchId, branchFilter));
    }

    const visits = await db
      .select()
      .from(patientVisits)
      .where(and(...visitConditions));

    // Group visits by YYYY-MM-DD
    const visitsByDate: Record<string, number> = {};
    visits.forEach(v => {
      const d = v.visitDate;
      visitsByDate[d] = (visitsByDate[d] || 0) + 1;
    });

    // 4. Generate Daily Data Array
    const chartData = [];
    let cumIncome = 0;
    let cumVisits = 0;
    
    // We only want to plot actuals up to today if looking at current month
    const todayStr = new Date().toISOString().split("T")[0];
    
    for (let i = 1; i <= numDays; i++) {
      const dateStr = `${monthStr}-${String(i).padStart(2, '0')}`;
      
      let actualIncome: number | null = incomeByDate[dateStr] || 0;
      let actualVisits: number | null = visitsByDate[dateStr] || 0;

      cumIncome += actualIncome;
      cumVisits += actualVisits;

      const targetCumIncome = dailyTargetIncome * i;
      const targetCumVisits = dailyTargetVisits * i;

      let displayCumIncome: number | null = cumIncome;
      let displayCumVisits: number | null = cumVisits;

      if (dateStr > todayStr) {
        displayCumIncome = null;
        displayCumVisits = null;
        actualIncome = null;
        actualVisits = null;
      }

      chartData.push({
        date: String(i),
        fullDate: dateStr,
        actualIncome,
        cumIncome: displayCumIncome,
        targetCumIncome: Math.round(targetCumIncome),
        actualVisits,
        cumVisits: displayCumVisits,
        targetCumVisits: Math.round(targetCumVisits),
      });
    }

    return NextResponse.json({
      month: monthStr,
      targetIncome,
      targetVisits,
      data: chartData
    });
  } catch (error) {
    console.error("Failed to fetch kpi chart data:", error);
    return NextResponse.json({ error: "Failed to fetch kpi chart data" }, { status: 500 });
  }
}
