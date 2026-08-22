import { NextRequest, NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, products } from "@/db/schema";

export const dynamic = "force-dynamic";

interface ProductPatchBody {
  name: string;
  description?: string;
  image_url?: string;
  price: number;
  sort_order?: number;
  is_active?: boolean;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    let body: ProductPatchBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "リクエストが不正です" },
        { status: 400 }
      );
    }

    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json(
        { error: "商品名を入力してください" },
        { status: 400 }
      );
    }
    if (!Number.isInteger(body.price) || body.price < 0) {
      return NextResponse.json(
        { error: "価格は0以上の整数で入力してください" },
        { status: 400 }
      );
    }

    const [updated] = await db
      .update(products)
      .set({
        name: body.name.trim(),
        description: body.description ?? "",
        image_url: (body.image_url ?? "").trim() || null,
        price: body.price,
        sort_order: Number.isInteger(body.sort_order)
          ? (body.sort_order as number)
          : 0,
        is_active: body.is_active ?? true,
      })
      .where(eq(products.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: "商品が見つかりません" },
        { status: 404 }
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Product update error:", error);
    return NextResponse.json(
      { error: "商品の保存に失敗しました" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // order_items references the product with ON DELETE restrict. Past orders
    // must keep pointing at it, so an ordered product is hidden, not deleted.
    const [{ value: ordered }] = await db
      .select({ value: count() })
      .from(orderItems)
      .where(eq(orderItems.product_id, id));

    if (ordered > 0) {
      return NextResponse.json(
        {
          error: `この商品にはすでに ${ordered} 件の注文があるため削除できません。販売を止めたい場合は「販売停止」にしてください。`,
        },
        { status: 409 }
      );
    }

    // Inventory rows cascade with the product.
    const [deleted] = await db
      .delete(products)
      .where(eq(products.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { error: "商品が見つかりません" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Product delete error:", error);
    return NextResponse.json(
      { error: "商品の削除に失敗しました" },
      { status: 500 }
    );
  }
}
