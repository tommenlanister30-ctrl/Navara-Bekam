import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts, journalEntries, journalLines } from "@/lib/db/schema";
import { eq, sum, desc, sql, gte, lte, and } from "drizzle-orm";
import { getSession } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = new URL(request.url).searchParams;
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    
    // 1. Fetch all accounts
    const allAccounts = await db.select().from(accounts);
    
    // 2. Fetch all journal lines with entry date
    let query = db.select({
      accountId: journalLines.accountId,
      debit: journalLines.debit,
      credit: journalLines.credit,
      date: journalEntries.date,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id));

    const conditions = [];
    if (startDate) {
      const startObj = new Date(startDate);
      startObj.setHours(0, 0, 0, 0);
      conditions.push(gte(journalEntries.date, startObj.toISOString()));
    }
    if (endDate) {
      const endObj = new Date(endDate);
      endObj.setHours(23, 59, 59, 999);
      conditions.push(lte(journalEntries.date, endObj.toISOString()));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const lines = await query;

    // Aggregate balances per account
    const accountBalances: Record<string, { debit: number, credit: number, balance: number, type: string, name: string }> = {};
    
    allAccounts.forEach(acc => {
      accountBalances[acc.id] = { debit: 0, credit: 0, balance: 0, type: acc.type, name: acc.name };
    });

    lines.forEach(line => {
      if (accountBalances[line.accountId]) {
        accountBalances[line.accountId].debit += line.debit;
        accountBalances[line.accountId].credit += line.credit;
      }
    });

    // Calculate normal balances
    // ASSET & EXPENSE & COGS: Normal Debit (Balance = Debit - Credit)
    // LIABILITY & EQUITY & REVENUE: Normal Credit (Balance = Credit - Debit)
    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;
    let totalRevenue = 0;
    let totalCOGS = 0;
    let totalExpense = 0;
    let cashFlowIn = 0;
    let cashFlowOut = 0;

    Object.keys(accountBalances).forEach(id => {
      const acc = accountBalances[id];
      if (["ASSET", "EXPENSE", "COGS"].includes(acc.type)) {
        acc.balance = acc.debit - acc.credit;
      } else {
        acc.balance = acc.credit - acc.debit;
      }

      // Group totals
      if (acc.type === "ASSET") totalAssets += acc.balance;
      if (acc.type === "LIABILITY") totalLiabilities += acc.balance;
      if (acc.type === "EQUITY") totalEquity += acc.balance;
      if (acc.type === "REVENUE") totalRevenue += acc.balance;
      if (acc.type === "COGS") totalCOGS += acc.balance;
      if (acc.type === "EXPENSE") totalExpense += acc.balance;
      
      // Cash Flow (simplified: assuming acc_101 is main cash)
      if (id === "acc_101") {
        cashFlowIn += acc.debit;
        cashFlowOut += acc.credit;
      }
    });

    const grossProfit = totalRevenue - totalCOGS;
    const netIncome = grossProfit - totalExpense;
    
    // Balance Sheet Equation: Assets = Liabilities + Equity + Net Income
    const currentEquity = totalEquity + netIncome;

    // 3. Fetch recent journal entries for Jurnal Umum
    let journalsQuery = db.select().from(journalEntries);
    
    if (conditions.length > 0) {
      journalsQuery = journalsQuery.where(and(...conditions)) as any;
    }
    
    const recentJournalsRaw = await journalsQuery
      .orderBy(desc(journalEntries.date))
      .limit(50);
      
    // Fetch lines for these journals
    const recentJournalIds = recentJournalsRaw.map(j => j.id);
    let recentLines: any[] = [];
    if (recentJournalIds.length > 0) {
       recentLines = await db.select({
         id: journalLines.id,
         entryId: journalLines.entryId,
         accountId: journalLines.accountId,
         debit: journalLines.debit,
         credit: journalLines.credit,
         accountName: accounts.name
       })
       .from(journalLines)
       .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
       .where(sql`${journalLines.entryId} IN ${recentJournalIds}`);
    }

    const journals = recentJournalsRaw.map(j => ({
      ...j,
      lines: recentLines.filter(l => l.entryId === j.id)
    }));

    return NextResponse.json({
      success: true,
      data: {
        balances: accountBalances,
        metrics: {
          totalAssets,
          totalLiabilities,
          totalEquity: currentEquity, // Updated with Net Income
          totalRevenue,
          totalCOGS,
          totalExpense,
          grossProfit,
          netIncome,
          cashFlowIn,
          cashFlowOut,
          netCashFlow: cashFlowIn - cashFlowOut
        },
        journals
      }
    });

  } catch (error: any) {
    console.error("Accounting API Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
