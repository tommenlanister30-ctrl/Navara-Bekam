import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { monthlyTargets } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { getActiveBranchFilter, getSession } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    let month = searchParams.get("month");

    if (!month) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    const branchFilter = await getActiveBranchFilter();

    if (branchFilter) {
      const targets = await db
        .select()
        .from(monthlyTargets)
        .where(and(eq(monthlyTargets.month, month), eq(monthlyTargets.branchId, branchFilter)));
      
      if (targets.length === 0) {
        return NextResponse.json({ 
          month, 
          targetIncome: 0, 
          targetVisits: 0 
        });
      }
      return NextResponse.json(targets[0]);
    } else {
      // Super Admin: Consolidated View (Sum all branches targets)
      const targets = await db
        .select()
        .from(monthlyTargets)
        .where(eq(monthlyTargets.month, month));
      
      let targetIncome = 0;
      let targetVisits = 0;

      targets.forEach(t => {
        targetIncome += t.targetIncome;
        targetVisits += t.targetVisits;
      });

      return NextResponse.json({
        month,
        targetIncome,
        targetVisits,
        isConsolidated: true
      });
    }
  } catch (error) {
    console.error("Failed to fetch monthly target:", error);
    return NextResponse.json({ error: "Failed to fetch monthly target" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { month, targetIncome, targetVisits, branchId: bodyBranchId } = body;

    if (!month) {
      return NextResponse.json({ error: "Month is required" }, { status: 400 });
    }

    let branchId = bodyBranchId && bodyBranchId !== "ALL" ? bodyBranchId : await getActiveBranchFilter();
    if (session.role !== "SUPER_ADMIN" && session.role !== "INVESTOR") {
      branchId = session.branchId;
    }

    if (!branchId || branchId === "ALL") {
      return NextResponse.json({ error: "Silakan pilih cabang spesifik terlebih dahulu untuk mengubah target." }, { status: 400 });
    }

    const tIncome = parseInt(targetIncome) || 0;
    const tVisits = parseInt(targetVisits) || 0;
    const targetId = `${branchId}-${month}`;

    // Check if exists
    const existing = await db.select().from(monthlyTargets).where(eq(monthlyTargets.id, targetId));

    let updatedTarget;
    if (existing.length > 0) {
      await db.update(monthlyTargets)
        .set({
          targetIncome: tIncome,
          targetVisits: tVisits,
          updatedAt: new Date().toISOString()
        })
        .where(eq(monthlyTargets.id, targetId));
      
      updatedTarget = { ...existing[0], targetIncome: tIncome, targetVisits: tVisits };
    } else {
      updatedTarget = {
        id: targetId,
        month,
        branchId,
        targetIncome: tIncome,
        targetVisits: tVisits,
        updatedAt: new Date().toISOString()
      };
      await db.insert(monthlyTargets).values(updatedTarget);
    }

    return NextResponse.json(updatedTarget, { status: 200 });
  } catch (error) {
    console.error("Failed to save monthly target:", error);
    return NextResponse.json({ error: "Failed to save monthly target" }, { status: 500 });
  }
}
