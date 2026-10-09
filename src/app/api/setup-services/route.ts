import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { services } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allServices = await db.select().from(services);
    
    for (const s of allServices) {
      const name = s.name.toLowerCase();
      let newCategory: "Paket Treatment" | "Full Body Massages" | "Refleksi" | "Bekam" | "Adds On" = "Paket Treatment";
      
      if (name.includes("refleksi") && name.includes("bekam")) {
        newCategory = "Paket Treatment";
      } else if (name.includes("paket") || name.includes("bundling")) {
        newCategory = "Paket Treatment";
      } else if (name.includes("refleksi") || name.includes("pijat") || name.includes("totok")) {
        newCategory = "Refleksi";
      } else if (name.includes("cek") || name.includes("mcu") || name.includes("infrared")) {
        newCategory = "Adds On";
      } else {
        newCategory = "Bekam";
      }

      await db.update(services).set({ category: newCategory }).where(eq(services.id, s.id));
    }

    return NextResponse.json({ success: true, message: "Services categorized successfully!" });
  } catch (error: any) {
    console.error("Migration error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
