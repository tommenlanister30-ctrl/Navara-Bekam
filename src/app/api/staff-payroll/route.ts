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
      baseSalary, allowances, bonuses, deductions, notes 
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

    // Check if already generated for this month
    const existing = await db
      .select()
      .from(staffPayrollReports)
      .where(and(eq(staffPayrollReports.staffId, staffId), eq(staffPayrollReports.month, month)));

    if (existing && existing.length > 0) {
      return NextResponse.json({ error: "Payroll report already generated for this staff in this month" }, { status: 400 });
    }

    const takeHomePay = (baseSalary || 0) + (allowances || 0) + (bonuses || 0) - (deductions || 0);

    const newReport = {
      id: crypto.randomUUID(),
      staffId,
      month,
      attendancePresent: attendancePresent || 0,
      attendanceLate: attendanceLate || 0,
      attendanceAbsent: attendanceAbsent || 0,
      baseSalary: baseSalary || 0,
      allowances: allowances || 0,
      bonuses: bonuses || 0,
      deductions: deductions || 0,
      takeHomePay,
      notes: notes || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await db.insert(staffPayrollReports).values(newReport);

    return NextResponse.json({ success: true, data: newReport }, { status: 201 });
  } catch (error) {
    console.error("Failed to create staff payroll:", error);
    return NextResponse.json({ error: "Failed to create staff payroll" }, { status: 500 });
  }
}
