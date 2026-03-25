import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateOrderNumber } from "@/lib/utils";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface OrderRequestBody {
  event_id: string;
  event_date_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  payment_method: "cash";
  items: Array<{ product_id: string; quantity: number }>;
}

export async function POST(request: NextRequest) {
  try {
    const body: OrderRequestBody = await request.json();

    // Validate input
    if (
      !body.event_id ||
      !body.event_date_id ||
      !body.customer_name ||
      !body.customer_email ||
      !body.customer_phone ||
      !body.payment_method ||
      !body.items ||
      body.items.length === 0
    ) {
      return NextResponse.json(
        { error: "必須項目が不足しています" },
        { status: 400 }
      );
    }

    for (const item of body.items) {
      if (!item.product_id || !item.quantity || item.quantity < 1) {
        return NextResponse.json(
          { error: "商品情報が不正です" },
          { status: 400 }
        );
      }
    }

    // Check inventory for all items
    const inventoryChecks = await Promise.all(
      body.items.map(async (item) => {
        const { data: inventory, error } = await supabaseAdmin
          .from("daily_product_inventory")
          .select("*, product:products(*)")
          .eq("event_date_id", body.event_date_id)
          .eq("product_id", item.product_id)
          .single();

        if (error || !inventory) {
          return { valid: false, item, inventory: null, reason: "在庫情報が見つかりません" };
        }

        const remaining = inventory.production_quantity - inventory.reserved_quantity;
        if (remaining < item.quantity || inventory.is_sold_out) {
          return {
            valid: false,
            item,
            inventory,
            reason: `「${inventory.product?.name}」の在庫が不足しています（残り${Math.max(0, remaining)}個）`,
          };
        }

        return { valid: true, item, inventory, reason: null };
      })
    );

    const failedChecks = inventoryChecks.filter((c) => !c.valid);
    if (failedChecks.length > 0) {
      return NextResponse.json(
        {
          error: "在庫が不足している商品があります",
          details: failedChecks.map((c) => c.reason),
        },
        { status: 400 }
      );
    }

    // Calculate total amount
    let totalAmount = 0;
    const orderItems = inventoryChecks.map((check) => {
      const unitPrice = check.inventory!.product!.price as number;
      const subtotal = unitPrice * check.item.quantity;
      totalAmount += subtotal;
      return {
        product_id: check.item.product_id,
        product_name_snapshot: check.inventory!.product!.name as string,
        unit_price: unitPrice,
        quantity: check.item.quantity,
        subtotal,
      };
    });

    // Generate order number
    const orderNumber = generateOrderNumber();

    // Insert order
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .insert({
        order_number: orderNumber,
        event_id: body.event_id,
        event_date_id: body.event_date_id,
        customer_name: body.customer_name,
        customer_email: body.customer_email,
        customer_phone: body.customer_phone,
        total_amount: totalAmount,
        payment_status: "paid",
        payment_method: body.payment_method,
        order_status: "confirmed",
        pickup_status: "not_picked_up",
        paid_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (orderError || !order) {
      console.error("Order insert error:", orderError);
      return NextResponse.json(
        { error: "注文の作成に失敗しました" },
        { status: 500 }
      );
    }

    // Insert order items
    const orderItemsWithOrderId = orderItems.map((item) => ({
      ...item,
      order_id: order.id,
    }));

    const { error: itemsError } = await supabaseAdmin
      .from("order_items")
      .insert(orderItemsWithOrderId);

    if (itemsError) {
      console.error("Order items insert error:", itemsError);
      // Attempt to clean up the order
      await supabaseAdmin.from("orders").delete().eq("id", order.id);
      return NextResponse.json(
        { error: "注文明細の作成に失敗しました" },
        { status: 500 }
      );
    }

    // Update inventory for each item
    for (const check of inventoryChecks) {
      const inventory = check.inventory!;
      const newReserved = inventory.reserved_quantity + check.item.quantity;
      const remaining = inventory.production_quantity - newReserved;

      const updateData: Record<string, unknown> = {
        reserved_quantity: newReserved,
      };

      if (remaining <= 0) {
        updateData.is_sold_out = true;
      }

      const { error: invError } = await supabaseAdmin
        .from("daily_product_inventory")
        .update(updateData)
        .eq("id", inventory.id);

      if (invError) {
        console.error("Inventory update error:", invError);
      }
    }

    // Check if event_date reservation_status needs updating
    const { data: allInventory } = await supabaseAdmin
      .from("daily_product_inventory")
      .select("production_quantity, reserved_quantity, is_sold_out, warning_threshold")
      .eq("event_date_id", body.event_date_id);

    if (allInventory && allInventory.length > 0) {
      const allSoldOut = allInventory.every((inv) => inv.is_sold_out);
      const anyNearThreshold = allInventory.some((inv) => {
        const remaining = inv.production_quantity - inv.reserved_quantity;
        return remaining <= inv.warning_threshold && remaining > 0;
      });

      let newStatus: "open" | "few_left" | "closed" = "open";
      if (allSoldOut) {
        newStatus = "closed";
      } else if (anyNearThreshold) {
        newStatus = "few_left";
      }

      await supabaseAdmin
        .from("event_dates")
        .update({ reservation_status: newStatus })
        .eq("id", body.event_date_id);
    }

    // Fetch the complete order with items
    const { data: completeOrder } = await supabaseAdmin
      .from("orders")
      .select("*, order_items:order_items(*)")
      .eq("id", order.id)
      .single();

    return NextResponse.json(completeOrder, { status: 201 });
  } catch (error) {
    console.error("Order creation error:", error);
    return NextResponse.json(
      { error: "注文処理中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
