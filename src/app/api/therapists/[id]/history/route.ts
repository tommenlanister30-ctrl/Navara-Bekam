import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { therapists, patientVisits, patients, services, therapistCommissions, invoices } from "@/lib/db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { getSession, checkBranchAccess, getActiveBranchFilter } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month"); // YYYY-MM format
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");

    let filterStartDate = "";
    let filterEndDate = "";

    if (startDateParam && endDateParam) {
      filterStartDate = startDateParam;
      filterEndDate = endDateParam;
    } else if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [year, m] = month.split("-");
      filterStartDate = `${year}-${m}-01`;
      const lastDay = new Date(parseInt(year), parseInt(m), 0).getDate();
      filterEndDate = `${year}-${m}-${String(lastDay).padStart(2, "0")}`;
    } else {
      return NextResponse.json({ error: "Query parameter 'startDate' dan 'endDate' atau 'month' diperlukan" }, { status: 400 });
    }

    // Get therapist info to verify existence and access
    const therapistData = await db.select().from(therapists).where(eq(therapists.id, id)).limit(1);
    
    if (therapistData.length === 0) {
      return NextResponse.json({ error: "Terapis tidak ditemukan" }, { status: 404 });
    }

    const therapist = therapistData[0];

    // Authorization checks
    if (session.role === "THERAPIST") {
      // Allow if the session name matches the therapist name or if they have the same phone
      if (session.name !== therapist.name && session.username !== therapist.phone) {
        return NextResponse.json({ error: "Forbidden: Anda hanya bisa melihat data Anda sendiri" }, { status: 403 });
      }
    } else {
      const isAllowed = await checkBranchAccess(therapist.branchId);
      if (!isAllowed) {
        return NextResponse.json({ error: "Forbidden: Anda tidak memiliki akses ke data cabang ini" }, { status: 403 });
      }
    }

    const branchFilter = await getActiveBranchFilter();
    
    const visitConditions: any[] = [
      gte(patientVisits.visitDate, filterStartDate),
      lte(patientVisits.visitDate, filterEndDate)
    ];

    if (branchFilter) {
      visitConditions.push(eq(patientVisits.branchId, branchFilter));
    }

    const { or, like } = await import("drizzle-orm");
    const crypto = await import("crypto");
    const { calculateTherapistCommission } = await import("@/lib/commission");
    const { financeTransactions } = await import("@/lib/db/schema");

    const allServices = await db.select().from(services);

    // Fetch visits for this therapist in the specified month
    // We fetch visits where the therapist is either the main therapist OR they received a commission
    const visitsRaw = await db
      .select({
        id: patientVisits.id,
        patientId: patientVisits.patientId,
        visitDate: patientVisits.visitDate,
        visitTime: patientVisits.visitTime,
        status: patientVisits.status,
        patientName: patients.name,
        serviceName: services.name,
        servicePrice: services.price,
        branchId: patientVisits.branchId,
        patientVisitTherapistId: patientVisits.therapistId,
        commissionId: therapistCommissions.id,
        commissionAmount: therapistCommissions.amount,
        commissionStatus: therapistCommissions.status,
        commissionTherapistId: therapistCommissions.therapistId,
        invoiceItems: invoices.items,
        invoiceTotal: invoices.grandTotal,
      })
      .from(patientVisits)
      .leftJoin(patients, eq(patientVisits.patientId, patients.id))
      .leftJoin(services, eq(patientVisits.serviceId, services.id))
      .leftJoin(therapistCommissions, eq(patientVisits.id, therapistCommissions.visitId))
      .leftJoin(invoices, eq(patientVisits.id, invoices.visitId))
      .where(
        and(
          ...visitConditions,
          or(
            eq(patientVisits.therapistId, id),
            eq(therapistCommissions.therapistId, id)
          )
        )
      );

    // Group by patientId, date, and time to avoid duplicates from multiple services taken at the same time
    const visitsMap = new Map<string, any>();

    for (const row of visitsRaw) {
      // Only include visits where this therapist was either the main therapist OR received a commission
      if (row.patientVisitTherapistId !== id && row.commissionTherapistId !== id) {
        continue;
      }

      const datePart = (row.visitDate || "").substring(0, 10);
      const groupKey = `${row.patientId}_${datePart}_${row.visitTime}`;

      if (!visitsMap.has(groupKey)) {
        visitsMap.set(groupKey, {
          id: row.id,
          visitDate: row.visitDate,
          visitTime: row.visitTime,
          status: row.status,
          patientName: row.patientName,
          serviceName: row.serviceName,
          servicePrice: row.servicePrice,
          commissionAmount: 0,
          commissionStatus: null,
          _services: [row.serviceName],
          _prices: [row.servicePrice],
          _invoiceFound: false,
          _processedCommissionIds: new Set<string>(),
          _processedCommissionVisitIds: new Set<string>(),
        });
      }

      const visit = visitsMap.get(groupKey);

      if (visit.id !== row.id && !visit._services.includes(row.serviceName)) {
        visit._services.push(row.serviceName);
        visit._prices.push(row.servicePrice);
      }

      let invoiceCalculatedComm = 0;
      if (row.invoiceItems && !visit._invoiceFound) {
        try {
          const items = JSON.parse(row.invoiceItems);
          if (Array.isArray(items) && items.length > 0) {
            visit.serviceName = items.map((i: any) => {
              if (i.qty && i.qty > 1) return `${i.name} (x${i.qty})`;
              return i.name;
            }).join(" + ");
            visit.servicePrice = row.invoiceTotal || items.reduce((sum: number, i: any) => sum + (i.subtotal || (i.price * (i.qty || 1))), 0);
            visit._invoiceFound = true;

            // Calculate expected commission across all items on this invoice for this therapist
            for (const item of items) {
              const itemSvc = allServices.find(
                s => s.id === item.serviceId || s.id === item.id || (item.name && s.name?.toLowerCase().trim() === item.name?.toLowerCase().trim())
              );
              const targetServiceId = itemSvc?.id || item.serviceId;
              if (targetServiceId) {
                const itemComm = await calculateTherapistCommission(
                  db,
                  id,
                  targetServiceId,
                  item.qty || 1,
                  row.branchId
                );
                invoiceCalculatedComm += itemComm;
              }
            }
          }
        } catch (e) {}
      }

      // Add commission ONLY if it belongs to THIS therapist and we haven't processed this specific commission record yet
      const commKey = row.commissionId || row.id;
      if (row.commissionTherapistId === id && !visit._processedCommissionIds.has(commKey)) {
        visit.commissionAmount += (row.commissionAmount || 0);
        if (row.commissionStatus) {
          visit.commissionStatus = row.commissionStatus;
        }
        visit._processedCommissionIds.add(commKey);
      }

      // If invoice exists with multiple items/add-ons and stored commission was lower than invoice total commission,
      // auto-heal to ensure both services get commission (e.g. Full Body + Totok Wajah)
      if (invoiceCalculatedComm > 0 && visit.commissionAmount < invoiceCalculatedComm) {
        const diff = invoiceCalculatedComm - visit.commissionAmount;
        visit.commissionAmount = invoiceCalculatedComm;
        
        // Auto-heal DB record
        try {
          if (row.commissionId) {
            await db.update(therapistCommissions)
              .set({ amount: invoiceCalculatedComm })
              .where(eq(therapistCommissions.id, row.commissionId));

            await db.update(financeTransactions)
              .set({ amount: invoiceCalculatedComm })
              .where(and(
                eq(financeTransactions.referenceId, row.id),
                eq(financeTransactions.type, "EXPENSE"),
                like(financeTransactions.description, "%Bagi Hasil Terapis%")
              ));
          } else if (row.status === "completed") {
            const newCommId = crypto.randomUUID();
            await db.insert(therapistCommissions).values({
              id: newCommId,
              therapistId: id,
              visitId: row.id,
              amount: invoiceCalculatedComm,
              status: "PAID",
              paidAt: row.visitDate ? `${datePart}T12:00:00Z` : new Date().toISOString(),
            });
          }
        } catch (err) {
          console.error("Auto-heal commission error:", err);
        }
      }
    }

    // Format service names for visits without invoices
    for (const visit of visitsMap.values()) {
      if (!visit._invoiceFound && visit._services.length > 1) {
        visit.serviceName = visit._services.join(" + ");
        visit.servicePrice = visit._prices.reduce((sum: number, p: number) => sum + (p || 0), 0);
      }
      
      // Clean up internal properties
      delete visit._services;
      delete visit._prices;
      delete visit._invoiceFound;
      delete visit._processedCommissionIds;
      delete visit._processedCommissionVisitIds;
    }

    const visits = Array.from(visitsMap.values());

    // Sort descending by date and time
    visits.sort((a, b) => {
      const dateA = new Date(`${a.visitDate}T${a.visitTime.replace('.', ':')}`);
      const dateB = new Date(`${b.visitDate}T${b.visitTime.replace('.', ':')}`);
      return dateB.getTime() - dateA.getTime();
    });

    const totalTreatments = visits.filter(v => v.status === "completed").length;
    const totalCommissions = visits.reduce((sum, v) => sum + (v.commissionAmount || 0), 0);

    return NextResponse.json({
      therapist: {
        id: therapist.id,
        name: therapist.name,
        specialization: therapist.specialization,
      },
      period: {
        month,
        startDate: filterStartDate,
        endDate: filterEndDate,
      },
      summary: {
        totalTreatments,
        totalCommissions,
      },
      data: visits,
    });
  } catch (error) {
    console.error("GET /api/therapists/[id]/history error:", error);
    return NextResponse.json({ error: "Gagal mengambil riwayat pasien terapis" }, { status: 500 });
  }
}
