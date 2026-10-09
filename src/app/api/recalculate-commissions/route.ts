import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  therapistCommissions,
  patientVisits,
  therapistMonthlyReports,
  invoices,
} from "@/lib/db/schema";
import { eq, and, like, isNull, isNotNull, gte, lte } from "drizzle-orm";
import crypto from "crypto";
import { calculateTherapistCommission } from "@/lib/commission";
import { getSession } from "@/lib/auth";

// Allow up to 60s for this heavy recalculation operation
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("Memulai sinkronisasi ulang komisi historis...");

    // Ambil semua komisi beserta data layanannya
    const commissions = await db
      .select({
        id: therapistCommissions.id,
        therapistId: therapistCommissions.therapistId,
        visitId: therapistCommissions.visitId,
        amount: therapistCommissions.amount,
        serviceId: patientVisits.serviceId,
        visitDate: patientVisits.visitDate,
        branchId: patientVisits.branchId,
        patientId: patientVisits.patientId,
        invoiceItems: invoices.items,
      })
      .from(therapistCommissions)
      .innerJoin(
        patientVisits,
        eq(therapistCommissions.visitId, patientVisits.id),
      )
      .leftJoin(
        invoices,
        eq(patientVisits.id, invoices.visitId)
      );

    let fixedCount = 0;
    let newCount = 0;
    const fixedDetails: string[] = [];
    const affectedMonths = new Set<string>(); // Format: therapistId|YYYY-MM

    // Process commissions in batches to avoid timeout
    const BATCH_SIZE = 50;
    for (let i = 0; i < commissions.length; i += BATCH_SIZE) {
      const batch = commissions.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (c) => {
          if (!c.serviceId || !c.therapistId) return;

          let correctAmount = 0;
          if (c.serviceId) {
            // Hitung komisi dari layanan utama
            correctAmount = await calculateTherapistCommission(
              db,
              c.therapistId,
              c.serviceId,
              1, // Di sistem ini, qty biasanya dipisah menjadi multiple visit rows jika dipecah, atau qty selalu 1
              c.branchId
            );

            // Jika ada invoice, periksa apakah ada POS add-on yang tidak memiliki record patientVisits sendiri
            if (c.invoiceItems && c.patientId && c.visitDate) {
              try {
                const items = JSON.parse(c.invoiceItems);
                if (Array.isArray(items) && items.length > 1) {
                  const allVisits = await db.select({ serviceId: patientVisits.serviceId, id: patientVisits.id }).from(patientVisits).where(and(eq(patientVisits.patientId, c.patientId), like(patientVisits.visitDate, c.visitDate)));
                  const matchedVisitIds = new Set();
                  matchedVisitIds.add(c.visitId);
                  
                  for (const item of items) {
                    if (item.serviceId === c.serviceId && matchedVisitIds.has(c.visitId)) {
                      matchedVisitIds.delete(c.visitId);
                    } else if (item.serviceId) {
                      const match = allVisits.find(v => v.serviceId === item.serviceId && !matchedVisitIds.has(v.id));
                      if (match) {
                        matchedVisitIds.add(match.id);
                      } else {
                        const itemComm = await calculateTherapistCommission(db, c.therapistId, item.serviceId, item.qty || 1, c.branchId);
                        correctAmount += itemComm;
                      }
                    }
                  }
                }
              } catch (e) {
                console.error("Failed to parse invoice items for POS add-ons");
              }
            }
          }

          if (c.amount !== correctAmount) {
            await db
              .update(therapistCommissions)
              .set({ amount: correctAmount })
              .where(eq(therapistCommissions.id, c.id));
            fixedCount++;
            fixedDetails.push(
              `Diperbarui komisi ${c.id}: Rp ${c.amount} -> Rp ${correctAmount}`,
            );

            if (c.visitDate) {
              const month = c.visitDate.substring(0, 7);
              affectedMonths.add(`${c.therapistId}|${month}`);
            }
          }
        }),
      );
    }

    // CARI KUNJUNGAN YANG SELESAI TAPI TIDAK PUNYA KOMISI (termasuk UNPAID)
    const missingVisits = await db
      .select({
        visitId: patientVisits.id,
        therapistId: patientVisits.therapistId,
        serviceId: patientVisits.serviceId,
        visitDate: patientVisits.visitDate,
        paymentStatus: patientVisits.paymentStatus,
        branchId: patientVisits.branchId,
        patientId: patientVisits.patientId,
        invoiceItems: invoices.items,
      })
      .from(patientVisits)
      .leftJoin(
        therapistCommissions,
        eq(patientVisits.id, therapistCommissions.visitId),
      )
      .leftJoin(
        invoices,
        eq(patientVisits.id, invoices.visitId)
      )
      .where(
        and(
          eq(patientVisits.status, "completed"),
          isNotNull(patientVisits.therapistId),
          isNull(therapistCommissions.id),
        ),
      );

    // Process missing visits in batches
    for (let i = 0; i < missingVisits.length; i += BATCH_SIZE) {
      const batch = missingVisits.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (v) => {
          if (!v.therapistId || !v.serviceId) return;

          let commissionAmount = 0;
          if (v.serviceId) {
            commissionAmount = await calculateTherapistCommission(
              db,
              v.therapistId,
              v.serviceId,
              1, // quantity
              v.branchId
            );

            if (v.invoiceItems && v.patientId && v.visitDate) {
              try {
                const items = JSON.parse(v.invoiceItems);
                if (Array.isArray(items) && items.length > 1) {
                  const allVisits = await db.select({ serviceId: patientVisits.serviceId, id: patientVisits.id }).from(patientVisits).where(and(eq(patientVisits.patientId, v.patientId), like(patientVisits.visitDate, v.visitDate)));
                  const matchedVisitIds = new Set();
                  matchedVisitIds.add(v.visitId);
                  
                  for (const item of items) {
                    if (item.serviceId === v.serviceId && matchedVisitIds.has(v.visitId)) {
                      matchedVisitIds.delete(v.visitId);
                    } else if (item.serviceId) {
                      const match = allVisits.find(av => av.serviceId === item.serviceId && !matchedVisitIds.has(av.id));
                      if (match) {
                        matchedVisitIds.add(match.id);
                      } else {
                        const itemComm = await calculateTherapistCommission(db, v.therapistId, item.serviceId, item.qty || 1, v.branchId);
                        commissionAmount += itemComm;
                      }
                    }
                  }
                }
              } catch (e) {
                console.error("Failed to parse invoice items for POS add-ons in missing visits");
              }
            }
          }
          
          console.log(`[DEBUG] Visit ${v.visitId} | Therapist ${v.therapistId} | Service ${v.serviceId} | Calculated Comm: ${commissionAmount}`);

          if (commissionAmount > 0) {
            const newId = crypto.randomUUID();
            const commStatus = v.paymentStatus === "PAID" ? "PAID" : "PENDING";
            await db.insert(therapistCommissions).values({
              id: newId,
              therapistId: v.therapistId,
              visitId: v.visitId,
              amount: commissionAmount,
              status: commStatus,
              paidAt: commStatus === "PAID" ? new Date().toISOString() : null,
            });
            newCount++;
            fixedDetails.push(
              `Dibuat komisi baru ${newId} untuk kunjungan ${v.visitId} sebesar Rp ${commissionAmount}`,
            );

            if (v.visitDate) {
              const month = v.visitDate.substring(0, 7);
              affectedMonths.add(`${v.therapistId}|${month}`);
            }
          }
        }),
      );
    }

    // Sync reports - update both month-based and date-range-based reports
    let syncedReportsCount = 0;
    for (const affected of affectedMonths) {
      const [therapistId, month] = affected.split("|");

      // Derive date range from month for filtering visits
      const [year, m] = month.split("-");
      const monthStart = `${year}-${m}-01`;
      const lastDay = new Date(parseInt(year), parseInt(m), 0).getDate();
      const monthEnd = `${year}-${m}-${String(lastDay).padStart(2, "0")}`;

      // Find all reports for this therapist that overlap with this month
      // This handles both month-based reports AND date-range-based reports
      const reports = await db
        .select()
        .from(therapistMonthlyReports)
        .where(
          eq(therapistMonthlyReports.therapistId, therapistId),
        );

      // Filter reports that match this month (either by month field or by date range overlap)
      const matchingReports = reports.filter((r) => {
        // Match by month field
        if (r.month === month) return true;
        // Match by date range overlap: report's date range overlaps with the affected month
        if (r.startDate && r.endDate) {
          return r.startDate <= monthEnd && r.endDate >= monthStart;
        }
        return false;
      });

      for (const r of matchingReports) {
        // We must calculate the commission specifically for this report's branch (if it has one)
        // and date range (if it has one, otherwise use the month's start/end dates).
        const start = r.startDate || monthStart;
        const end = r.endDate || monthEnd;

        const rangeCommissions = await db
          .select({ amount: therapistCommissions.amount })
          .from(therapistCommissions)
          .innerJoin(
            patientVisits,
            eq(therapistCommissions.visitId, patientVisits.id),
          )
          .where(
            and(
              eq(therapistCommissions.therapistId, therapistId),
              gte(patientVisits.visitDate, start),
              lte(patientVisits.visitDate, end),
              r.branchId ? eq(patientVisits.branchId, r.branchId) : undefined
            ),
          );
        const reportTotalComm = rangeCommissions.reduce((s, c) => s + c.amount, 0);

        const newThp =
          r.baseSalary + reportTotalComm + r.allowances + r.bonuses - r.deductions;
        await db
          .update(therapistMonthlyReports)
          .set({
            commissions: reportTotalComm,
            takeHomePay: newThp,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(therapistMonthlyReports.id, r.id));
        syncedReportsCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Berhasil memperbaiki ${fixedCount} data komisi lama, membuat ${newCount} data komisi baru yang hilang, dan mensinkronisasi ${syncedReportsCount} laporan bulanan.`,
      details: fixedDetails,
    });
  } catch (error: unknown) {
    console.error("Gagal sinkronisasi komisi:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal Server Error",
      },
      { status: 500 },
    );
  }
}
