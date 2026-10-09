import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";

// GET: Fetch company settings
export async function GET() {
  try {
    const result = await db.select().from(settings).where(eq(settings.id, "company_info")).limit(1);
    
    if (!result || result.length === 0) {
      return NextResponse.json({ error: "Settings not found" }, { status: 404 });
    }

    return NextResponse.json(result[0]);
  } catch (error) {
    console.error("Error fetching settings:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

// PUT: Update company settings
export async function PUT(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { 
      companyName, description, address, phone, email, 
      whatsappNumber, facebookUrl, instagramUrl, youtubeUrl,
      heroBadgeText, heroTitle, heroDescription,
      operatingHours, operatingHoursWeekend, mapUrl,
      aboutPageContent
    } = body;

    if (!companyName || !address || !phone || !email || !whatsappNumber) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const updatedSetting = await db.update(settings)
      .set({
        companyName,
        description,
        address,
        phone,
        email,
        whatsappNumber,
        facebookUrl,
        instagramUrl,
        youtubeUrl,
        heroBadgeText,
        heroTitle,
        heroDescription,
        operatingHours,
        operatingHoursWeekend,
        mapUrl,
        aboutPageContent,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(settings.id, "company_info"))
      .returning();

    return NextResponse.json({ message: "Settings updated successfully", data: updatedSetting[0] });
  } catch (error) {
    console.error("Error updating settings:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
