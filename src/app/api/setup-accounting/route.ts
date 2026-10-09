import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts, financeTransactions, journalEntries, journalLines } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 1. Setup Master Chart of Accounts (CoA)
    const initialAccounts = [
      { id: "acc_101", code: "101", name: "Kas & Bank", type: "ASSET", isActive: true },
      { id: "acc_102", code: "102", name: "Persediaan", type: "ASSET", isActive: true },
      { id: "acc_103", code: "103", name: "Aset Tetap", type: "ASSET", isActive: true },
      { id: "acc_201", code: "201", name: "Hutang Usaha", type: "LIABILITY", isActive: true },
      { id: "acc_202", code: "202", name: "Hutang Komisi Terapis", type: "LIABILITY", isActive: true },
      { id: "acc_301", code: "301", name: "Modal Pemilik", type: "EQUITY", isActive: true },
      { id: "acc_302", code: "302", name: "Laba Ditahan", type: "EQUITY", isActive: true },
      { id: "acc_401", code: "401", name: "Pendapatan Layanan", type: "REVENUE", isActive: true },
      { id: "acc_402", code: "402", name: "Pendapatan Lainnya", type: "REVENUE", isActive: true },
      { id: "acc_501", code: "501", name: "Beban Komisi Terapis", type: "COGS", isActive: true },
      { id: "acc_502", code: "502", name: "HPP Barang", type: "COGS", isActive: true },
      { id: "acc_601", code: "601", name: "Beban Operasional", type: "EXPENSE", isActive: true },
      { id: "acc_602", code: "602", name: "Beban Gaji Karyawan", type: "EXPENSE", isActive: true },
      { id: "acc_603", code: "603", name: "Beban Lainnya", type: "EXPENSE", isActive: true },
    ];

    // Cek apakah akun Kas sudah ada
    const existingAccounts = await db.select().from(accounts).limit(1);
    
    if (existingAccounts.length === 0) {
      console.log("Seeding Chart of Accounts...");
      await db.insert(accounts).values(initialAccounts as any);
    }

    // 2. Migrasi Data finance_transactions lama ke Jurnal Umum
    // Jika belum ada journal_entries sama sekali
    const existingJournals = await db.select().from(journalEntries).limit(1);
    
    if (existingJournals.length === 0) {
      console.log("Migrating finance_transactions to Journal...");
      const allTransactions = await db.select().from(financeTransactions);
      
      for (const trx of allTransactions) {
        const jId = "jrn_" + Math.random().toString(36).substr(2, 9);
        
        // Buat Header Jurnal
        await db.insert(journalEntries).values({
          id: jId,
          date: trx.date,
          description: trx.description || `Migrasi: ${trx.category}`,
          referenceId: trx.id,
          createdAt: trx.date,
        });

        // Tentukan mapping akun berdasarkan kategori (simple rules)
        const kasAccountId = "acc_101"; // Kas
        let lawanAccountId = "";

        if (trx.type === "INCOME") {
          lawanAccountId = "acc_401"; // Pendapatan Layanan default
        } else {
          // EXPENSE
          if (trx.category.toLowerCase().includes("komisi") || trx.category.toLowerCase().includes("terapis")) {
            lawanAccountId = "acc_501"; // Beban Komisi (COGS)
          } else if (trx.category.toLowerCase().includes("stok") || trx.category.toLowerCase().includes("obat")) {
            lawanAccountId = "acc_502"; // HPP Barang (COGS)
          } else if (trx.category.toLowerCase().includes("gaji")) {
            lawanAccountId = "acc_602"; // Beban Gaji
          } else {
            lawanAccountId = "acc_601"; // Beban Operasional Default
          }
        }

        // Buat Line Jurnal (Double-Entry)
        if (trx.type === "INCOME") {
          // Income: Kas Bertambah (Debet), Pendapatan Bertambah (Kredit)
          await db.insert(journalLines).values([
            { id: "jline_" + Math.random().toString(36).substr(2, 9), entryId: jId, accountId: kasAccountId, debit: trx.amount, credit: 0 },
            { id: "jline_" + Math.random().toString(36).substr(2, 9), entryId: jId, accountId: lawanAccountId, debit: 0, credit: trx.amount }
          ]);
        } else {
          // Expense: Beban Bertambah (Debet), Kas Berkurang (Kredit)
          await db.insert(journalLines).values([
            { id: "jline_" + Math.random().toString(36).substr(2, 9), entryId: jId, accountId: lawanAccountId, debit: trx.amount, credit: 0 },
            { id: "jline_" + Math.random().toString(36).substr(2, 9), entryId: jId, accountId: kasAccountId, debit: 0, credit: trx.amount }
          ]);
        }
      }
    }

    return NextResponse.json({ success: true, message: "Accounting Setup Complete" });
  } catch (error: any) {
    console.error("Accounting setup error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
