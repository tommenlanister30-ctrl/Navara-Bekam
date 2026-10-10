import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { staffPayrollReports, staff } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { getSession, getActiveBranchFilter } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month");

    if (!month) {
      return NextResponse.json({ error: "Month parameter is required" }, { status: 400 });
    }

    const branchFilter = await getActiveBranchFilter();
    const conditions: any[] = [eq(staffPayrollReports.month, month)];
    if (branchFilter) {
      conditions.push(eq(staff.branchId, branchFilter));
    }

    const reports = await db
      .select({
        report: staffPayrollReports,
        staff: staff,
      })
      .from(staffPayrollReports)
      .leftJoin(staff, eq(staffPayrollReports.staffId, staff.id))
      .where(and(...conditions))
      .orderBy(desc(staffPayrollReports.createdAt));

    return NextResponse.json({ success: true, data: reports });
  } catch (error) {
    console.error("Failed to fetch staff payrolls:", error);
    return NextResponse.json({ error: "Failed to fetch staff payrolls" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { 
      staffId, month, attendancePresent, attendanceLate, attendanceAbsent, 
      baseSalary, allowances, bonuses, deductions, notes, updateStaffBaseSalary = true
    } = body;

    if (!staffId || !month) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Branch isolation check
    if (session.role !== "SUPER_ADMIN" && session.role !== "INVESTOR" && session.branchId) {
      const staffMember = await db.select().from(staff).where(eq(staff.id, staffId)).limit(1);
      if (staffMember.length === 0 || staffMember[0].branchId !== session.branchId) {
        return NextResponse.json({ error: "Forbidden: Karyawan bukan milik cabang Anda" }, { status: 403 });
      }
    }

    const parsedBaseSalary = typeof baseSalary === "number" ? baseSalary : (parseInt(baseSalary) || 0);
    const parsedAllowances = typeof allowances === "number" ? allowances : (parseInt(allowances) || 0);
    const parsedBonuses = typeof bonuses === "number" ? bonuses : (parseInt(bonuses) || 0);
    const parsedDeductions = typeof deductions === "number" ? deductions : (parseInt(deductions) || 0);
    const takeHomePay = parsedBaseSalary + parsedAllowances + parsedBonuses - parsedDeductions;

    // Check if already generated for this month
    const existing = await db
      .select()
      .from(staffPayrollReports)
      .where(and(eq(staffPayrollReports.staffId, staffId), eq(staffPayrollReports.month, month)));

    let savedReport;
    if (existing && existing.length > 0) {
      // Update existing report
      const updateData = {
        attendancePresent: attendancePresent !== undefined ? attendancePresent : existing[0].attendancePresent,
        attendanceLate: attendanceLate !== undefined ? attendanceLate : existing[0].attendanceLate,
        attendanceAbsent: attendanceAbsent !== undefined ? attendanceAbsent : existing[0].attendanceAbsent,
        baseSalary: parsedBaseSalary,
        allowances: parsedAllowances,
        bonuses: parsedBonuses,
        deductions: parsedDeductions,
        takeHomePay,
        notes: notes !== undefined ? notes : existing[0].notes,
        updatedAt: new Date().toISOString(),
      };
      await db.update(staffPayrollReports).set(updateData).where(eq(staffPayrollReports.id, existing[0].id));
      savedReport = { ...existing[0], ...updateData };
    } else {
      // Insert new report
      savedReport = {
        id: crypto.randomUUID(),
        staffId,
        month,
        attendancePresent: attendancePresent || 0,
        attendanceLate: attendanceLate || 0,
        attendanceAbsent: attendanceAbsent || 0,
        baseSalary: parsedBaseSalary,
        allowances: parsedAllowances,
        bonuses: parsedBonuses,
        deductions: parsedDeductions,
        takeHomePay,
        notes: notes || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await db.insert(staffPayrollReports).values(savedReport);
    }

    // Sync base salary to staff master data if desired and base salary is set
    if (updateStaffBaseSalary && parsedBaseSalary > 0) {
      await db.update(staff).set({ baseSalary: parsedBaseSalary }).where(eq(staff.id, staffId));
    }

    return NextResponse.json({ success: true, data: savedReport }, { status: 200 });
  } catch (error) {
    console.error("Failed to save staff payroll:", error);
    return NextResponse.json({ error: "Failed to save staff payroll" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  return POST(request);
}

export async function DELETE(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const reportId = searchParams.get("id");

    if (!reportId) {
      return NextResponse.json({ error: "Report ID is required" }, { status: 400 });
    }

    // Fetch the report first to validate ownership
    const existing = await db
      .select({ report: staffPayrollReports, staff: staff })
      .from(staffPayrollReports)
      .leftJoin(staff, eq(staffPayrollReports.staffId, staff.id))
      .where(eq(staffPayrollReports.id, reportId))
      .limit(1);

    if (!existing || existing.length === 0) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    // Branch isolation check
    if (session.role !== "SUPER_ADMIN" && session.role !== "INVESTOR" && session.branchId) {
      if (existing[0].staff?.branchId !== session.branchId) {
        return NextResponse.json({ error: "Forbidden: Karyawan bukan milik cabang Anda" }, { status: 403 });
      }
    }

    await db.delete(staffPayrollReports).where(eq(staffPayrollReports.id, reportId));

    return NextResponse.json({ success: true, message: "Payroll report deleted" });
  } catch (error) {
    console.error("Failed to delete staff payroll:", error);
    return NextResponse.json({ error: "Failed to delete staff payroll" }, { status: 500 });
  }
}
