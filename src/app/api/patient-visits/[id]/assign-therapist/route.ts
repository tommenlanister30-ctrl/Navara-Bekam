import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  patientVisits,
  invoices,
  therapists,
  therapistServiceCommissions,
  therapistCommissions,
  financeTransactions,
  therapistMonthlyReports
} from "@/lib/db/schema";
import { eq, and, like } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { createJournalEntry, COA } from "@/lib/accounting";
import crypto from "crypto";
import { logSystemAction } from "@/lib/logger";
import { calculateTherapistCommission } from "@/lib/commission";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { therapistId } = body;

    if (!therapistId) {
      return NextResponse.json({ error: "Terapis harus dipilih" }, { status: 400 });
    }

    // Run within a transaction
    const txResult = await db.transaction(async (tx) => {
      // 1. Get the visit
      const visits = await tx.select().from(patientVisits).where(eq(patientVisits.id, id)).limit(1);
      if (visits.length === 0) {
        throw new Error("Data kunjungan tidak ditemukan");
      }
      const visit = visits[0];

      if (visit.therapistId) {
        throw new Error("Kunjungan ini sudah memiliki terapis. Silakan hapus kunjungan dan catat ulang untuk mengganti terapis agar komisi keuangan tetap akurat.");
      }

      // 2. Get the new therapist
      const therapistRecords = await tx.select().from(therapists).where(eq(therapists.id, therapistId)).limit(1);
      if (therapistRecords.length === 0) {
        throw new Error("Terapis tidak ditemukan");
      }
      const therapist = therapistRecords[0];

      const now = new Date().toISOString();

      // 3. Update the visit
      await tx.update(patientVisits)
        .set({
          therapistId,
          updatedAt: now
        })
        .where(eq(patientVisits.id, id));

      // 4. Update the invoice if exists
      const relatedInvoices = await tx.select().from(invoices).where(eq(invoices.visitId, id)).limit(1);
      let invoice = null;
      if (relatedInvoices.length > 0) {
        invoice = relatedInvoices[0];
        await tx.update(invoices)
          .set({
            therapistId,
            therapistName: therapist.name
          })
          .where(eq(invoices.id, invoice.id));
      }

      // 5. Generate commission if visit is PAID
      if (visit.paymentStatus === "PAID") {
        // Find items to calculate commission
        let itemsToProcess = [];

        if (invoice && invoice.items) {
          try {
            itemsToProcess = JSON.parse(invoice.items);
          } catch (e) {
            console.error("Failed to parse invoice items:", e);
          }
        } else {
          // If no invoice, just use the visit's single service
          itemsToProcess = [
            {
              serviceId: visit.serviceId,
              name: "Layanan Kunjungan",
              qty: 1
            }
          ];
        }

        // Loop items and calculate total commissions
        let totalCommissionAmount = 0;
        const itemNames: string[] = [];

        for (const item of itemsToProcess) {
          const serviceId = item.serviceId;
          if (!serviceId) continue;

          const commissionAmount = await calculateTherapistCommission(
            tx,
            therapistId,
            serviceId,
            item.qty || 1,
            visit.branchId
          );

          if (commissionAmount > 0) {
            totalCommissionAmount += commissionAmount;
            itemNames.push(item.name || serviceId);
          }
        }

        if (totalCommissionAmount > 0) {
          // Hapus komisi lama jika ada untuk mencegah duplikasi
          await tx.delete(therapistCommissions).where(eq(therapistCommissions.visitId, id));
          await tx.delete(financeTransactions).where(
            and(
              eq(financeTransactions.referenceId, id),
              eq(financeTransactions.type, "EXPENSE"),
              like(financeTransactions.description, "%Bagi Hasil Terapis%")
            )
          );

          // Insert Commission
          await tx.insert(therapistCommissions).values({
            id: crypto.randomUUID(),
            therapistId,
            visitId: id,
            amount: totalCommissionAmount,
            status: "PAID",
            paidAt: now,
          });

          // Insert Expense Transaction
          const commTrxId = crypto.randomUUID();
          await tx.insert(financeTransactions).values({
            id: commTrxId,
            type: "EXPENSE",
            category: "Bagi Hasil Terapis",
            amount: totalCommissionAmount,
            description: `Bagi Hasil Terapis (${therapist.name}) untuk layanan ${itemNames.join(", ")} (Edit Kasir)`,
            referenceId: id,
            branchId: visit.branchId,
            paymentMethod: "CASH",
            date: now
          });

          // Auto Journal Entry
          await createJournalEntry({
            date: now,
            description: `[Auto] Beban Bagi Hasil Terapis: ${therapist.name} - ${itemNames.join(", ")} (Edit Kasir)`,
            referenceId: commTrxId,
            debitAccountId: COA.BEBAN_KOMISI,
            creditAccountId: COA.HUTANG_KOMISI,
            amount: totalCommissionAmount,
            tx
          });
        }
      }

      await logSystemAction("UPDATE_VISIT_THERAPIST", "patient_visit", id, `Terapis ditambahkan ke kunjungan lunas (ID: ${id}) dengan Terapis ID: ${therapistId}`);
      return { success: true };
    });

    return NextResponse.json({ success: true, data: txResult });
  } catch (error: any) {
    console.error("PATCH /api/patient-visits/[id]/assign-therapist error:", error);
    return NextResponse.json({ error: error.message || "Gagal mengubah terapis kunjungan" }, { status: 500 });
  }
}
