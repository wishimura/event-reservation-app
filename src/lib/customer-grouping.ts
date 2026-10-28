/**
 * 同じ方の注文をまとめる。
 *
 * 人気のある回では、同じ方が1日に何度も予約されます。カートがあっても、
 * 迷っているうちに他の方に取られるのが怖くて、思いついた順に1品ずつ決済
 * していくためです。当日カウンターでは「この方に何を渡せばいいのか」が
 * ばらばらの注文に散らばることになります。
 *
 * まとめるのはメールアドレスか電話番号が一致したときだけで、
 * **氏名では決してまとめません**。
 *
 * 取りこぼすより、間違ってまとめるほうが怖いからです。3件あるのに1件しか
 * お渡ししなければお客様が気づいて教えてくださいますが、同姓同名の別の方の
 * ぶんを一緒に渡してしまうと、その場では誰も気づけず、お二人とも困ります。
 *
 * かわりに、同じ受取日に同じ名前で連絡先の違う方がいたら、はっきり警告を
 * 出します。これが同姓同名の事故を防ぐ唯一の砦です。
 */

export interface GroupableOrder {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
}

/** 何が一致してまとまったか。 */
export type MatchedBy = "email" | "phone" | "both";

export interface CustomerGroup<T extends GroupableOrder> {
  /** 画面の key に使える、このまとまりの id。 */
  key: string;
  orders: T[];
  /** 1件だけのときは null。 */
  matchedBy: MatchedBy | null;
  /**
   * 同じ受取日に、同じ氏名で連絡先の違う別のまとまりがあるか。
   * true なら、画面で必ず注意を出すこと。
   */
  hasNameCollision: boolean;
}

/** 大文字小文字と前後の空白だけ揃える。 */
export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * 数字だけ取り出して比べる。
 *
 * 入力欄はハイフンも括弧も空白も通すので、同じ方が書き方を変えただけで
 * 別人になってしまいます。国番号つきで書かれた場合も国内表記に揃えます。
 *
 *   090-1234-5678 / 09012345678 / 090 1234 5678 / +81 90 1234 5678
 *     → すべて 09012345678
 */
export function normalizePhone(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return "";

  // +81 90... のような国番号つきを 090... に戻す
  if (digits.startsWith("81") && digits.length >= 11) {
    return `0${digits.slice(2)}`;
  }
  return digits;
}

/** 見比べる意味のある長さか。短すぎる入力で他人とぶつからないように。 */
function usablePhone(phone: string): boolean {
  return phone.length >= 10;
}

/**
 * 注文をお客様ごとにまとめる。
 *
 * メールアドレスか電話番号のどちらかが一致すれば同じ方とみなします（or）。
 * 片方ずつ違う注文が連鎖してつながることもありますが、ご家族で片方の番号を
 * 使われた場合などは、実際に一緒に来店されるので、まとまっていて困りません。
 *
 * 渡された順番は保ちます。
 */
export function groupByCustomer<T extends GroupableOrder>(
  orders: T[]
): CustomerGroup<T>[] {
  // 同じ連絡先どうしをつないでいく（union-find）
  const parent = new Map<string, string>();

  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // 経路圧縮
    let walk = id;
    while (parent.get(walk) !== root) {
      const next = parent.get(walk)!;
      parent.set(walk, root);
      walk = next;
    }
    return root;
  };

  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  for (const order of orders) parent.set(order.id, order.id);

  const byEmail = new Map<string, string>();
  const byPhone = new Map<string, string>();

  for (const order of orders) {
    const email = normalizeEmail(order.customer_email);
    if (email) {
      const seen = byEmail.get(email);
      if (seen) union(seen, order.id);
      else byEmail.set(email, order.id);
    }

    const phone = normalizePhone(order.customer_phone);
    if (usablePhone(phone)) {
      const seen = byPhone.get(phone);
      if (seen) union(seen, order.id);
      else byPhone.set(phone, order.id);
    }
  }

  // 元の順番のまま、まとまりごとに集める
  const collected = new Map<string, T[]>();
  for (const order of orders) {
    const root = find(order.id);
    const list = collected.get(root) ?? [];
    list.push(order);
    collected.set(root, list);
  }

  const groups: CustomerGroup<T>[] = [...collected.entries()].map(
    ([key, list]) => ({
      key,
      orders: list,
      matchedBy: list.length > 1 ? matchOf(list) : null,
      hasNameCollision: false,
    })
  );

  flagNameCollisions(groups);
  return groups;
}

/** まとまり全体で、メールと電話のどちらが揃っているか。 */
function matchOf<T extends GroupableOrder>(list: T[]): MatchedBy {
  const emails = new Set(list.map((o) => normalizeEmail(o.customer_email)).filter(Boolean));
  const phones = new Set(
    list.map((o) => normalizePhone(o.customer_phone)).filter(usablePhone)
  );

  const sameEmail = emails.size === 1 && emails.size > 0;
  const samePhone = phones.size === 1 && phones.size > 0;

  if (sameEmail && samePhone) return "both";
  if (sameEmail) return "email";
  return "phone";
}

/**
 * 同じ氏名のまとまりが2つ以上あれば、両方に印をつける。
 *
 * 連絡先が違う以上こちらは別の方として扱いますが、カウンターでお名前だけを
 * 聞いて取り違える危険が残るので、画面でそれを伝えられるようにします。
 */
function flagNameCollisions<T extends GroupableOrder>(
  groups: CustomerGroup<T>[]
): void {
  const byName = new Map<string, CustomerGroup<T>[]>();

  for (const group of groups) {
    const name = (group.orders[0]?.customer_name ?? "").trim().replace(/\s+/g, "");
    if (!name) continue;
    const list = byName.get(name) ?? [];
    list.push(group);
    byName.set(name, list);
  }

  for (const list of byName.values()) {
    if (list.length > 1) {
      for (const group of list) group.hasNameCollision = true;
    }
  }
}

/** 画面に出す、まとめた理由。 */
export function matchedByLabel(matchedBy: MatchedBy | null): string {
  switch (matchedBy) {
    case "both":
      return "メールアドレスと電話番号が一致";
    case "email":
      return "メールアドレスが一致";
    case "phone":
      return "電話番号が一致（別のメールアドレスで予約）";
    default:
      return "";
  }
}
