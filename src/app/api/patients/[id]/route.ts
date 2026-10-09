import { db } from "@/lib/db";
import { patients, patientVisits, services, branches, therapists } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: patientId } = await params;

    // Fetch patient data
    const patientData = await db
      .select()
      .from(patients)
      .where(eq(patients.id, patientId))
      .limit(1);

    if (patientData.length === 0) {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }

    const patient = patientData[0];

    // Fetch visit history with joined details
    const visits = await db
      .select({
        id: patientVisits.id,
        visitDate: patientVisits.visitDate,
        visitTime: patientVisits.visitTime,
        status: patientVisits.status,
        paymentStatus: patientVisits.paymentStatus,
        bloodPressure: patientVisits.bloodPressure,
        notes: patientVisits.notes,
        serviceName: services.name,
        serviceCategory: services.category,
        branchName: branches.name,
        therapistName: therapists.name,
      })
      .from(patientVisits)
      .leftJoin(services, eq(patientVisits.serviceId, services.id))
      .leftJoin(branches, eq(patientVisits.branchId, branches.id))
      .leftJoin(therapists, eq(patientVisits.therapistId, therapists.id))
      .where(eq(patientVisits.patientId, patientId))
      .orderBy(desc(patientVisits.visitDate), desc(patientVisits.visitTime));

    return NextResponse.json({
      success: true,
      data: {
        ...patient,
        visits,
      }
    });
  } catch (error) {
    console.error("GET /api/patients/[id] error:", error);
    return NextResponse.json({ error: "Gagal mengambil detail pasien" }, { status: 500 });
  }
}
