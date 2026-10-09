import { db } from "@/lib/db";
import { therapists, therapistMonthlyReports, patientVisits, attendance, therapistCommissions, branches } from "@/lib/db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
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

    // Determine strict branch filter:
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

    // 1. Fetch active therapists strictly isolated by branch to prevent cross-branch leakage
    const therapistConditions = [eq(therapists.isActive, true)];
    if (branchFilter) {
      therapistConditions.push(eq(therapists.branchId, branchFilter));
    }

    const activeTherapists = await db
      .select()
      .from(therapists)
      .where(and(...therapistConditions));

    // 2. Pre-fetch commissions & visits for the period, strictly scoped to branch if filtered
    const visitConditions = [
      gte(patientVisits.visitDate, startIso),
      lte(patientVisits.visitDate, endIso),
    ];
    if (branchFilter) {
      visitConditions.push(eq(patientVisits.branchId, branchFilter));
    }

    const allMonthCommissions = await db
      .select({
        therapistId: therapistCommissions.therapistId,
        branchId: patientVisits.branchId,
        amount: therapistCommissions.amount,
      })
      .from(therapistCommissions)
      .innerJoin(patientVisits, eq(therapistCommissions.visitId, patientVisits.id))
      .where(and(...visitConditions));

    const allMonthVisits = await db
      .select({
        therapistId: patientVisits.therapistId,
        branchId: patientVisits.branchId,
      })
      .from(patientVisits)
      .where(
        and(
          eq(patientVisits.status, "completed"),
          ...visitConditions
        )
      );

    // 3. Pre-fetch saved reports for the period, strictly filtered by branch if active
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

    const savedReportsMap = new Map<string, typeof savedReports[0]>();
    savedReports.forEach((r) => {
      savedReportsMap.set(`${r.therapistId}_${r.branchId || "none"}`, r);
      if (!savedReportsMap.has(r.therapistId)) {
        savedReportsMap.set(r.therapistId, r);
      }
    });

    // 4. Pre-fetch branch names for clean display
    const allBranches = await db.select({ id: branches.id, name: branches.name }).from(branches);
    const branchNameMap = new Map(allBranches.map((b) => [b.id, b.name]));

    // 5. Build report per therapist with branch isolation
    const data = await Promise.all(
      activeTherapists.map(async (t) => {
        // Calculate commissions & treatments for this therapist, respecting their branch
        const actualCommissions = allMonthCommissions
          .filter((c) => c.therapistId === t.id && (!t.branchId || c.branchId === t.branchId))
          .reduce((sum, c) => sum + c.amount, 0);

        const actualTreatments = allMonthVisits
          .filter((v) => v.therapistId === t.id && (!t.branchId || v.branchId === t.branchId))
          .length;

        const reportKey = `${t.id}_${t.branchId || "none"}`;
        const saved = savedReportsMap.get(reportKey) || savedReportsMap.get(t.id);

        if (saved) {
          const newTakeHomePay = saved.baseSalary + actualCommissions + saved.allowances + saved.bonuses - saved.deductions;
          return {
            ...saved,
            therapistName: t.name,
            branchId: t.branchId || saved.branchId,
            branchName: branchNameMap.get(t.branchId || saved.branchId || "") || "Tanpa Cabang",
            commissions: actualCommissions,
            totalTreatments: actualTreatments,
            takeHomePay: newTakeHomePay,
            isSaved: true,
          };
        }

        // Attendance strictly isolated by therapist and branch
        const attendanceConditions = [
          eq(attendance.therapistId, t.id),
          gte(attendance.date, filterStartDate as string),
          lte(attendance.date, filterEndDate as string),
        ];
        if (t.branchId) {
          attendanceConditions.push(eq(attendance.branchId, t.branchId));
        }

        const attendanceLogs = await db
          .select({ status: attendance.status })
          .from(attendance)
          .where(and(...attendanceConditions));

        let present = 0;
        let late = 0;
        let absent = 0;
        attendanceLogs.forEach((log) => {
          if (log.status === "PRESENT") present++;
          else if (log.status === "LATE") late++;
          else if (log.status === "ABSENT") absent++;
        });

        const takeHomePay = t.baseSalary + actualCommissions;

        return {
          id: null,
          therapistId: t.id,
          therapistName: t.name,
          branchId: t.branchId,
          branchName: branchNameMap.get(t.branchId || "") || "Tanpa Cabang",
          month,
          startDate: filterStartDate,
          endDate: filterEndDate,
          totalTreatments: actualTreatments,
          attendancePresent: present,
          attendanceLate: late,
          attendanceAbsent: absent,
          attendancePermit: 0,
          baseSalary: t.baseSalary,
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

    return Response.json({ data });
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
