import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { productImages } from "@/db/schema";
import { isUuid } from "@/lib/http";

/**
 * Serves an uploaded product photo.
 *
 * Public, like the products it illustrates. Each upload gets its own id and
 * the bytes behind it never change, so it can be cached indefinitely — a
 * replaced photo is a different id and a different address.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Postgres rejects a malformed uuid rather than returning nothing.
  if (!isUuid(id)) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const [image] = await db
      .select()
      .from(productImages)
      .where(eq(productImages.id, id))
      .limit(1);

    if (!image) return new NextResponse(null, { status: 404 });

    return new NextResponse(Buffer.from(image.data_base64, "base64"), {
      headers: {
        "Content-Type": image.content_type,
        "Content-Length": String(image.byte_size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Image read error:", error);
    return new NextResponse(null, { status: 500 });
  }
}
