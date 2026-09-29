import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { productImages } from "@/db/schema";

export const dynamic = "force-dynamic";

/** Only formats every browser can display. SVG is excluded: it can carry script. */
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Generous, because the console shrinks pictures before sending them. A file
 * this big means the shrinking did not happen, which is worth refusing rather
 * than storing.
 */
const MAX_BYTES = 3 * 1024 * 1024;

/**
 * Takes a product photo uploaded from the console.
 *
 * Returns the path to serve it from, which goes into `products.image_url`
 * exactly like an external address would. Nothing downstream needs to know
 * where the picture came from.
 */
export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "画像を受け取れませんでした" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "画像が選ばれていません" }, { status: 400 });
  }

  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: "JPEG・PNG・WebP の画像を選んでください" },
      { status: 400 }
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "画像が空です" }, { status: 400 });
  }
  if (bytes.byteLength > MAX_BYTES) {
    return NextResponse.json(
      { error: "画像が大きすぎます。3MB以下にしてください" },
      { status: 400 }
    );
  }

  try {
    const [saved] = await db
      .insert(productImages)
      .values({
        content_type: file.type,
        byte_size: bytes.byteLength,
        data_base64: Buffer.from(bytes).toString("base64"),
      })
      .returning({ id: productImages.id });

    return NextResponse.json({ url: `/api/images/${saved.id}` }, { status: 201 });
  } catch (error) {
    console.error("Image upload error:", error);
    return NextResponse.json({ error: "画像の保存に失敗しました" }, { status: 500 });
  }
}
