import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { therapists, therapistCommissions, therapistServiceCommissions, financeTransactions, patientVisits } from "@/lib/db/schema";
import { eq, and, ne, like } from "drizzle-orm";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 1. Find Suci
    const allTherapists = await db.select().from(therapists);
    const suci = allTherapists.find(t => t.name.toLowerCase().includes("suci"));
    if (!suci) return NextResponse.json({ error: "Suci not found" }, { status: 404 });

    // 2. Find a reference therapist for global commissions
    const refTherapist = allTherapists.find(t => t.id !== suci.id && t.isActive);
    if (!refTherapist) return NextResponse.json({ error: "No reference therapist" }, { status: 400 });

    const globalComms = await db.select().from(therapistServiceCommissions).where(eq(therapistServiceCommissions.therapistId, refTherapist.id));
    
    // 3. Fix Suci's overrides
    const suciComms = await db.select().from(therapistServiceCommissions).where(eq(therapistServiceCommissions.therapistId, suci.id));
    
    for (const gComm of globalComms) {
      const existing = suciComms.find(c => c.serviceId === gComm.serviceId);
      if (!existing) {
        await db.insert(therapistServiceCommissions).values({
          id: crypto.randomUUID(), therapistId: suci.id,
          serviceId: gComm.serviceId,
          commissionAmount: gComm.commissionAmount,
        });
      } else if (existing.commissionAmount !== gComm.commissionAmount) {
        await db.update(therapistServiceCommissions)
          .set({ commissionAmount: gComm.commissionAmount })
          .where(and(eq(therapistServiceCommissions.therapistId, suci.id), eq(therapistServiceCommissions.serviceId, gComm.serviceId)));
      }
    }

    // 4. Fix Suci's past commissions
    const { invoices } = await import("@/lib/db/schema");
    const pastCommissions = await db.select().from(therapistCommissions).where(eq(therapistCommissions.therapistId, suci.id));
    
    let updatedCount = 0;
    for (const comm of pastCommissions) {
      // Find the service id for this visit
      const visitRecords = await db.select().from(patientVisits).where(eq(patientVisits.id, comm.visitId)).limit(1);
      if (visitRecords.length > 0) {
        const visit = visitRecords[0];

        // Do not overwrite visits that have multi-service invoice add-ons
        const invRecords = await db.select().from(invoices).where(eq(invoices.visitId, visit.id)).limit(1);
        if (invRecords.length > 0 && invRecords[0].items) {
          try {
            const items = JSON.parse(invRecords[0].items);
            if (Array.isArray(items) && items.length > 1) {
              continue;
            }
          } catch (e) {}
        }

        const expectedComm = globalComms.find(g => g.serviceId === visit.serviceId);
        
        if (expectedComm && expectedComm.commissionAmount !== null && expectedComm.commissionAmount !== comm.amount) {
          // Update therapist_commissions
          await db.update(therapistCommissions)
            .set({ amount: expectedComm.commissionAmount })
            .where(eq(therapistCommissions.id, comm.id));
            
          // Update finance_transactions
          await db.update(financeTransactions)
            .set({ amount: expectedComm.commissionAmount })
            .where(and(
              eq(financeTransactions.referenceId, comm.visitId),
              eq(financeTransactions.type, "EXPENSE"),
              like(financeTransactions.description, "%Bagi Hasil Terapis%")
            ));
            
          updatedCount++;
        }
      }
    }

    return NextResponse.json({ success: true, suciId: suci.id, updatedCommissionsCount: updatedCount });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
