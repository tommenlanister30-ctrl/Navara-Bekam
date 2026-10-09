import { db } from "@/lib/db";
import { patients } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await db.select().from(patients);
    return Response.json({ data: result });
  } catch (error) {
    console.error("GET /api/patients error:", error);
    return Response.json({ error: "Gagal mengambil data pasien" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, phone, address, gender } = body;

    if (!name || !phone) {
      return Response.json({ error: "Nama dan nomor telepon wajib diisi" }, { status: 400 });
    }

    const newId = `P-${Date.now()}`;
    const result = await db.insert(patients).values({
      id: newId,
      name,
      phone,
      address,
      gender,
    }).returning();

    return Response.json({ data: result[0] });
  } catch (error) {
    console.error("POST /api/patients error:", error);
    return Response.json({ error: "Gagal menambah data pasien" }, { status: 500 });
  }
}
