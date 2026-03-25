export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
}

export function formatPrice(price: number): string {
  return `¥${price.toLocaleString()}`;
}

export function generateOrderNumber(): string {
  const now = new Date();
  const ts = now.getFullYear().toString().slice(2) +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ORD-${ts}-${rand}`;
}

export function getRemainingQuantity(inv: { production_quantity: number; reserved_quantity: number }) {
  return Math.max(0, inv.production_quantity - inv.reserved_quantity);
}

export function getStatusLabel(status: string): { label: string; color: string } {
  switch (status) {
    case "open":
      return { label: "受付中", color: "bg-emerald-100 text-emerald-800" };
    case "few_left":
      return { label: "残りわずか", color: "bg-amber-100 text-amber-800" };
    case "closed":
      return { label: "受付終了", color: "bg-stone-200 text-stone-500" };
    default:
      return { label: status, color: "bg-stone-100 text-stone-600" };
  }
}
