import { db } from "@/lib/db";
import { therapists, therapistMonthlyReports, patientVisits, attendance, therapistCommissions, branches } from "@/lib/db/schema";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { getSession, getActiveBranchFilter } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month"); // YYYY-MM
    const startDate = searchParams.get("startDate"); // YYYY-MM-DD
    const endDate = searchParams.get("endDate"); // YYYY-MM-DD
    const branchIdParam = searchParams.get("branchId");

    let filterStartDate = startDate;
    let filterEndDate = endDate;

    if (!filterStartDate || !filterEndDate) {
      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        return Response.json({ error: "Periode bulan (YYYY-MM) atau rentang tanggal wajib diisi" }, { status: 400 });
      }
      // Derive start and end date from month
      const [year, m] = month.split("-");
      filterStartDate = `${year}-${m}-01`;
      const lastDay = new Date(parseInt(year), parseInt(m), 0).getDate();
      filterEndDate = `${year}-${m}-${lastDay}`;
    }

    // Determine branch filter:
    // Non-super-admin users CANNOT access other branches under any circumstances.
    let branchFilter: string | null = null;
    if (session.role !== "SUPER_ADMIN" && session.role !== "INVESTOR") {
      branchFilter = session.branchId;
    } else {
      if (branchIdParam !== null && branchIdParam !== undefined) {
        branchFilter = branchIdParam === "ALL" ? null : branchIdParam;
      } else {
        branchFilter = await getActiveBranchFilter();
      }
    }

    // Konversi filterStartDate dan filterEndDate ke format ISO UTC (+07:00 WIB)
    const startIso = new Date(`${filterStartDate}T00:00:00+07:00`).toISOString();
    const endIso = new Date(`${filterEndDate}T23:59:59.999+07:00`).toISOString();

    // 1. Fetch completed visits in this period (scoped to branch if filtered)
    const visitConditions = [
      gte(patientVisits.visitDate, startIso),
      lte(patientVisits.visitDate, endIso),
      eq(patientVisits.status, "completed"),
    ];
    if (branchFilter) {
      visitConditions.push(eq(patientVisits.branchId, branchFilter));
    }

    const allMonthVisits = await db
      .select({
        id: patientVisits.id,
        therapistId: patientVisits.therapistId,
        branchId: patientVisits.branchId,
      })
      .from(patientVisits)
      .where(and(...visitConditions));

    // 2. Fetch commissions in this period
    const commVisitConditions = [
      gte(patientVisits.visitDate, startIso),
      lte(patientVisits.visitDate, endIso),
    ];
    if (branchFilter) {
      commVisitConditions.push(eq(patientVisits.branchId, branchFilter));
    }

    const allMonthCommissions = await db
      .select({
        therapistId: therapistCommissions.therapistId,
        branchId: patientVisits.branchId,
        amount: therapistCommissions.amount,
      })
      .from(therapistCommissions)
      .innerJoin(patientVisits, eq(therapistCommissions.visitId, patientVisits.id))
      .where(and(...commVisitConditions));

    // 3. Fetch saved reports in this period
    const reportConditions: any[] = [];
    if (month) {
      reportConditions.push(eq(therapistMonthlyReports.month, month));
    } else {
      reportConditions.push(
        and(
          eq(therapistMonthlyReports.startDate, filterStartDate as string),
          eq(therapistMonthlyReports.endDate, filterEndDate as string)
        )
      );
    }
    if (branchFilter) {
      reportConditions.push(eq(therapistMonthlyReports.branchId, branchFilter));
    }

    const savedReports = await db
      .select()
      .from(therapistMonthlyReports)
      .where(and(...reportConditions));

    // 4. Pre-fetch branch names for clean display
    const allBranches = await db.select({ id: branches.id, name: branches.name }).from(branches);
    const branchNameMap = new Map(allBranches.map((b) => [b.id, b.name]));

    // 5. Dynamic Branch Attribution:
    // Therapists are attributed to the branch where they actually treated patients in this period
    // because the salary/commission burden is borne by that branch!
    const activePairsMap = new Map<string, { therapistId: string; branchId: string }>();

    allMonthVisits.forEach((v) => {
      const bId = v.branchId || branchFilter || "";
      if (v.therapistId && bId) {
        const key = `${v.therapistId}_${bId}`;
        if (!activePairsMap.has(key)) {
          activePairsMap.set(key, { therapistId: v.therapistId, branchId: bId });
        }
      }
    });

    // Also include saved reports that have activity
    savedReports.forEach((r) => {
      const bId = r.branchId || branchFilter || "";
      if (r.therapistId && bId && r.totalTreatments > 0) {
        const key = `${r.therapistId}_${bId}`;
        if (!activePairsMap.has(key)) {
          activePairsMap.set(key, { therapistId: r.therapistId, branchId: bId });
        }
      }
    });

    const activePairs = Array.from(activePairsMap.values());
    if (activePairs.length === 0) {
      return Response.json({ data: [] });
    }

    const therapistIds = Array.from(new Set(activePairs.map((p) => p.therapistId)));
    const activeTherapists = await db
      .select()
      .from(therapists)
      .where(inArray(therapists.id, therapistIds));

    const therapistMap = new Map(activeTherapists.map((t) => [t.id, t]));

    // 6. Build report per therapist for the branch where they handled patients
    const data = await Promise.all(
      activePairs.map(async (pair) => {
        const t = therapistMap.get(pair.therapistId);
        if (!t) return null;

        // Treatments handled by this therapist AT THIS SPECIFIC BRANCH
        const actualTreatments = allMonthVisits.filter(
          (v) => v.therapistId === pair.therapistId && (v.branchId === pair.branchId || (!v.branchId && pair.branchId === branchFilter))
        ).length;

        // Strictly do NOT display therapists with 0 treatments
        if (actualTreatments === 0) return null;

        // Commissions earned by this therapist AT THIS SPECIFIC BRANCH
        const actualCommissions = allMonthCommissions
          .filter((c) => c.therapistId === pair.therapistId && (c.branchId === pair.branchId || (!c.branchId && pair.branchId === branchFilter)))
          .reduce((sum, c) => sum + c.amount, 0);

        // Find existing saved report for this therapist at this branch
        const saved = savedReports.find(
          (r) => r.therapistId === pair.therapistId && (r.branchId === pair.branchId || (!r.branchId && pair.branchId === branchFilter))
        );

        if (saved) {
          const newTakeHomePay = saved.baseSalary + actualCommissions + saved.allowances + saved.bonuses - saved.deductions;
          return {
            ...saved,
            therapistName: t.name,
            branchId: pair.branchId,
            branchName: branchNameMap.get(pair.branchId) || "Tanpa Cabang",
            commissions: actualCommissions,
            totalTreatments: actualTreatments,
            takeHomePay: newTakeHomePay,
            isSaved: true,
          };
        }

        // Attendance for this therapist during the period
        const attendanceLogs = await db
          .select({ status: attendance.status, branchId: attendance.branchId })
          .from(attendance)
          .where(
            and(
              eq(attendance.therapistId, t.id),
              gte(attendance.date, filterStartDate as string),
              lte(attendance.date, filterEndDate as string)
            )
          );

        // Filter attendance matching this branch (or global)
        const relevantAttendance = attendanceLogs.filter(
          (a) => !a.branchId || a.branchId === pair.branchId
        );

        let present = 0;
        let late = 0;
        let absent = 0;
        relevantAttendance.forEach((log) => {
          if (log.status === "PRESENT") present++;
          else if (log.status === "LATE") late++;
          else if (log.status === "ABSENT") absent++;
        });

        const baseSalary = t.baseSalary;
        const takeHomePay = baseSalary + actualCommissions;

        return {
          id: null,
          therapistId: t.id,
          therapistName: t.name,
          branchId: pair.branchId,
          branchName: branchNameMap.get(pair.branchId) || "Tanpa Cabang",
          month,
          startDate: filterStartDate,
          endDate: filterEndDate,
          totalTreatments: actualTreatments,
          attendancePresent: present,
          attendanceLate: late,
          attendanceAbsent: absent,
          attendancePermit: 0,
          baseSalary,
          commissions: actualCommissions,
          allowances: 0,
          bonuses: 0,
          deductions: 0,
          takeHomePay,
          notesStrengths: "",
          notesImprovements: "",
          notesTargets: "",
          rating: "5.0",
          isSaved: false,
        };
      })
    );

    const filteredData = data.filter((item): item is NonNullable<typeof item> => item !== null && item.totalTreatments > 0);

    return Response.json({ data: filteredData });
  } catch (error) {
    console.error("GET /api/therapist-reports error:", error);
    return Response.json({ error: "Gagal mengambil data laporan" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      id,
      therapistId,
      month,
      startDate,
      endDate,
      totalTreatments,
      attendancePresent,
      attendanceLate,
      attendanceAbsent,
      attendancePermit,
      baseSalary,
      commissions,
      allowances,
      bonuses,
      deductions,
      takeHomePay,
      notesStrengths,
      notesImprovements,
      notesTargets,
      rating,
      branchId,
    } = body;

    if (!therapistId || (!month && (!startDate || !endDate))) {
      return Response.json({ error: "Data terapis dan bulan/rentang tanggal wajib diisi" }, { status: 400 });
    }

    // Determine target branch
    const targetBranchId = branchId || (session.role !== "SUPER_ADMIN" ? session.branchId : null);
    const now = new Date().toISOString();

    if (id) {
      // Update existing report
      await db
        .update(therapistMonthlyReports)
        .set({
          branchId: targetBranchId || undefined,
          startDate: startDate || null,
          endDate: endDate || null,
          totalTreatments: parseInt(totalTreatments) || 0,
          attendancePresent: parseInt(attendancePresent) || 0,
          attendanceLate: parseInt(attendanceLate) || 0,
          attendanceAbsent: parseInt(attendanceAbsent) || 0,
          attendancePermit: parseInt(attendancePermit) || 0,
          baseSalary: parseInt(baseSalary) || 0,
          commissions: parseInt(commissions) || 0,
          allowances: parseInt(allowances) || 0,
          bonuses: parseInt(bonuses) || 0,
          deductions: parseInt(deductions) || 0,
          takeHomePay: parseInt(takeHomePay) || 0,
          notesStrengths: notesStrengths || "",
          notesImprovements: notesImprovements || "",
          notesTargets: notesTargets || "",
          rating: rating || "5.0",
          updatedAt: now,
        })
        .where(eq(therapistMonthlyReports.id, id));

      return Response.json({ success: true, id });
    } else {
      const baseCondition = eq(therapistMonthlyReports.therapistId, therapistId);
      const periodCondition = month 
        ? eq(therapistMonthlyReports.month, month)
        : and(
            eq(therapistMonthlyReports.startDate, startDate),
            eq(therapistMonthlyReports.endDate, endDate)
          );
      const branchCondition = targetBranchId ? eq(therapistMonthlyReports.branchId, targetBranchId) : undefined;

      const existing = await db
        .select()
        .from(therapistMonthlyReports)
        .where(branchCondition ? and(baseCondition, periodCondition, branchCondition) : and(baseCondition, periodCondition))
        .limit(1);

      if (existing.length > 0) {
        return Response.json({ error: "Laporan untuk terapis ini pada periode ini sudah dibuat" }, { status: 400 });
      }

      const newId = crypto.randomUUID();
      await db.insert(therapistMonthlyReports).values({
        id: newId,
        therapistId,
        branchId: targetBranchId || null,
        month: month || null,
        startDate: startDate || null,
        endDate: endDate || null,
        totalTreatments: parseInt(totalTreatments) || 0,
        attendancePresent: parseInt(attendancePresent) || 0,
        attendanceLate: parseInt(attendanceLate) || 0,
        attendanceAbsent: parseInt(attendanceAbsent) || 0,
        attendancePermit: parseInt(attendancePermit) || 0,
        baseSalary: parseInt(baseSalary) || 0,
        commissions: parseInt(commissions) || 0,
        allowances: parseInt(allowances) || 0,
        bonuses: parseInt(bonuses) || 0,
        deductions: parseInt(deductions) || 0,
        takeHomePay: parseInt(takeHomePay) || 0,
        notesStrengths: notesStrengths || "",
        notesImprovements: notesImprovements || "",
        notesTargets: notesTargets || "",
        rating: rating || "5.0",
        createdAt: now,
        updatedAt: now,
      });

      return Response.json({ success: true, id: newId });
    }
  } catch (error) {
    console.error("POST /api/therapist-reports error:", error);
    return Response.json({ error: "Gagal menyimpan laporan" }, { status: 500 });
  }
}
