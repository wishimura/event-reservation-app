export interface Event {
  id: string;
  name: string;
  description: string;
  start_date: string;
  end_date: string;
  pickup_location: string;
  reservation_note: string;
  is_active: boolean;
}

export interface Product {
  id: string;
  event_id: string;
  name: string;
  description: string;
  price: number;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface EventDate {
  id: string;
  event_id: string;
  pickup_date: string;
  reservation_open: boolean;
  reservation_status: "open" | "few_left" | "closed";
  reservation_close_at: string | null;
  is_active: boolean;
}

export interface DailyProductInventory {
  id: string;
  event_date_id: string;
  product_id: string;
  production_quantity: number;
  reserved_quantity: number;
  is_sold_out: boolean;
  is_hidden: boolean;
  warning_threshold: number;
  product?: Product;
}

export interface Order {
  id: string;
  order_number: string;
  event_id: string;
  event_date_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  total_amount: number;
  payment_status: "pending" | "paid" | "failed" | "refunded";
  payment_method: "cash" | "credit_card";
  order_status: "temporary" | "confirmed" | "cancelled";
  pickup_status: "not_picked_up" | "picked_up" | "absent";
  created_at: string;
  paid_at: string | null;
  event_date?: EventDate;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  product_name_snapshot: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
  product?: Product;
}

export interface CartItem {
  product: Product;
  inventory: DailyProductInventory;
  quantity: number;
}
