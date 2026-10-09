import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { financeTransactions, patientVisits } from "@/lib/db/schema";
import { sql, eq, and, like, gte, lt } from "drizzle-orm";
import { getActiveBranchFilter, getSession } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const branchFilter = await getActiveBranchFilter();
    
    // 1. Calculate Today's Revenue
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    const todayDateCond = and(
      gte(financeTransactions.date, todayStr),
      lt(financeTransactions.date, tomorrowStr)
    );

    let todayRevenueQuery = db
      .select({ totalAmount: sql<number>`SUM(${financeTransactions.amount})` })
      .from(financeTransactions)
      .where(
        and(
          eq(financeTransactions.type, "INCOME"),
          todayDateCond
        )
      );

    if (branchFilter) {
      todayRevenueQuery = db
        .select({ totalAmount: sql<number>`SUM(${financeTransactions.amount})` })
        .from(financeTransactions)
        .where(
          and(
            eq(financeTransactions.type, "INCOME"),
            todayDateCond,
            eq(financeTransactions.branchId, branchFilter)
          )
        );
    }
    
    const todayRevenueRes = await todayRevenueQuery;
    const todayRevenue = todayRevenueRes[0]?.totalAmount || 0;

    // 2. Calculate Last 7 Days Revenue & Visits
    // We'll fetch all transactions and visits from the last 7 days and group them in code for simplicity
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0];

    let financeQuery = db
      .select({ date: financeTransactions.date, amount: financeTransactions.amount, type: financeTransactions.type })
      .from(financeTransactions)
      .where(gte(financeTransactions.date, sevenDaysAgoStr));
      
    if (branchFilter) {
      financeQuery = db
        .select({ date: financeTransactions.date, amount: financeTransactions.amount, type: financeTransactions.type })
        .from(financeTransactions)
        .where(
          and(
            gte(financeTransactions.date, sevenDaysAgoStr),
            eq(financeTransactions.branchId, branchFilter)
          )
        );
    }

    const recentFinance = await financeQuery;

    let visitsQuery = db
      .select({ visitDate: patientVisits.visitDate })
      .from(patientVisits)
      .where(
        and(
          eq(patientVisits.status, "completed"),
          gte(patientVisits.visitDate, sevenDaysAgoStr)
        )
      );

    if (branchFilter) {
      visitsQuery = db
        .select({ visitDate: patientVisits.visitDate })
        .from(patientVisits)
        .where(
          and(
            eq(patientVisits.status, "completed"),
            gte(patientVisits.visitDate, sevenDaysAgoStr),
            eq(patientVisits.branchId, branchFilter)
          )
        );
    }
    
    const recentVisits = await visitsQuery;

    // Aggregate by day
    const last7DaysMap = new Map();
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const dayName = d.toLocaleDateString("en-US", { weekday: 'short' }); // Mon, Tue, etc.
      last7DaysMap.set(dateStr, { date: dateStr, day: dayName, revenue: 0, visits: 0 });
    }

    for (const tx of recentFinance) {
      const d = tx.date.split("T")[0];
      if (last7DaysMap.has(d) && tx.type === "INCOME") {
        last7DaysMap.get(d).revenue += tx.amount;
      }
    }

    for (const v of recentVisits) {
      const d = v.visitDate;
      if (last7DaysMap.has(d)) {
        last7DaysMap.get(d).visits += 1;
      }
    }

    // Convert map to array and sort chronologically (oldest to newest)
    const last7Days = Array.from(last7DaysMap.values()).reverse();

    // 3. Income vs Outcome Ratio for the current month
    const currentMonth = todayStr.substring(0, 7);
    const [curYearStr, curMthStr] = currentMonth.split('-');
    const curYear = parseInt(curYearStr, 10);
    const curMth = parseInt(curMthStr, 10);
    const monthStart = `${currentMonth}-01`;
    let nextYear = curYear;
    let nextMonth = curMth + 1;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    const monthEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

    const monthFinanceCond = and(
      gte(financeTransactions.date, monthStart),
      lt(financeTransactions.date, monthEnd)
    );

    let monthFinanceQuery = db
      .select({
        type: financeTransactions.type,
        totalAmount: sql<number>`SUM(${financeTransactions.amount})`
      })
      .from(financeTransactions)
      .where(monthFinanceCond);
      
    if (branchFilter) {
      monthFinanceQuery = db
        .select({
          type: financeTransactions.type,
          totalAmount: sql<number>`SUM(${financeTransactions.amount})`
        })
        .from(financeTransactions)
        .where(
          and(
            monthFinanceCond,
            eq(financeTransactions.branchId, branchFilter)
          )
        );
    }

    const monthFinance = await monthFinanceQuery.groupBy(financeTransactions.type);
    
    let monthIncome = 0;
    let monthExpense = 0;

    for (const row of monthFinance) {
      if (row.type === "INCOME") monthIncome = row.totalAmount;
      if (row.type === "EXPENSE") monthExpense = row.totalAmount;
    }

    const total = monthIncome + monthExpense;
    const incomeOutcomeRatio = {
      incomePercent: total > 0 ? Math.round((monthIncome / total) * 100) : 0,
      expensePercent: total > 0 ? Math.round((monthExpense / total) * 100) : 0,
      incomeAmount: monthIncome,
      expenseAmount: monthExpense
    };

    return NextResponse.json({
      success: true,
      data: {
        todayRevenue,
        last7Days,
        incomeOutcomeRatio
      }
    });

  } catch (error) {
    console.error("Dashboard mobile chart API error:", error);
    return NextResponse.json(
      { success: false, error: "Gagal mengambil data chart" },
      { status: 500 }
    );
  }
}
