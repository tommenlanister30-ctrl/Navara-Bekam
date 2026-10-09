import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { financeTransactions, journalEntries, journalLines } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { logSystemAction } from "@/lib/logger";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Get transaction info before deleting (for audit log)
    const existing = await db.select().from(financeTransactions).where(eq(financeTransactions.id, id)).limit(1);
    if (existing.length === 0) {
      return NextResponse.json({ error: "Transaksi tidak ditemukan" }, { status: 404 });
    }
    const trx = existing[0];

    // Branch isolation check
    if (session.role !== "SUPER_ADMIN" && session.role !== "INVESTOR" && session.branchId && trx.branchId !== session.branchId) {
      return NextResponse.json({ error: "Forbidden: Transaksi bukan milik cabang Anda" }, { status: 403 });
    }

    // Delete related journal entries and lines first
    const relatedJournals = await db.select({ id: journalEntries.id })
      .from(journalEntries)
      .where(eq(journalEntries.referenceId, id));
    const journalIds = relatedJournals.map(j => j.id);

    if (journalIds.length > 0) {
      await db.delete(journalLines).where(inArray(journalLines.entryId, journalIds));
      await db.delete(journalEntries).where(inArray(journalEntries.id, journalIds));
    }

    // Delete the finance transaction
    await db.delete(financeTransactions).where(eq(financeTransactions.id, id));

    await logSystemAction(
      "DELETE_FINANCE_TRX",
      "finance_transaction",
      id,
      `Transaksi keuangan dihapus: ${trx.type} - ${trx.category} (Rp ${trx.amount}) - ${trx.description}`
    );

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete finance transaction:", error);
    return NextResponse.json({ error: "Failed to delete transaction" }, { status: 500 });
  }
}
