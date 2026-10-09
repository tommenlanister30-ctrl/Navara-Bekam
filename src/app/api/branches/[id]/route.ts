import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { branches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session || session.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json();
    const { name, address, phone, whatsappNumber, operatingHours, operatingHoursWeekend, mapUrl, isActive, brand, taxRate } = body;

    const updatedBranch = await db.update(branches)
      .set({
        name,
        address,
        phone,
        whatsappNumber,
        operatingHours: operatingHours || "09:00 - 21:00 WIB",
        operatingHoursWeekend: operatingHoursWeekend || "09:00 - 21:00 WIB",
        mapUrl: mapUrl || null,
        isActive: isActive !== undefined ? isActive : true,
        brand: brand || "NAVARA",
        taxRate: taxRate !== undefined ? Number(taxRate) : 0,
      })
      .where(eq(branches.id, id))
      .returning();

    if (!updatedBranch || updatedBranch.length === 0) {
      return NextResponse.json({ error: "Cabang tidak ditemukan" }, { status: 404 });
    }

    return NextResponse.json({ message: "Cabang berhasil diperbarui", data: updatedBranch[0] });
  } catch (error) {
    console.error("Error updating branch:", error);
    return NextResponse.json({ error: "Gagal memperbarui cabang" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session || session.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    // Note: If branch is referenced in other tables, this might fail unless cascading delete is set up.
    // Real-world scenario might prefer "soft delete" (isActive = false).
    await db.delete(branches).where(eq(branches.id, id));

    return NextResponse.json({ message: "Cabang berhasil dihapus" });
  } catch (error) {
    console.error("Error deleting branch:", error);
    return NextResponse.json({ error: "Gagal menghapus cabang, pastikan tidak ada data yang terhubung" }, { status: 500 });
  }
}
