"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, fetchJson } from "@/lib/api-client";
import { LoadErrorNotice } from "@/components/LoadErrorNotice";
import { groupByCustomer, matchedByLabel } from "@/lib/customer-grouping";
import { diningStyleLabel } from "@/lib/tax";
import { formatDate, formatPrice } from "@/lib/utils";
import type { DiningStyle, EventDate, Order, OrderItem } from "@/lib/types";

interface PickupOrder extends Order {
  order_items: OrderItem[];
}

export default function PickupPage() {
  const [orders, setOrders] = useState<PickupOrder[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  /**
   * いま見ている受取日と、選べる日。
   *
   * 既定は今日です。先の日も開けますが、**その日は見るだけ**にします
   * （`isToday` を参照）。前もって何件来るかを知っておくための画面で、
   * まだ渡していないものに「渡した」と付けられる必要はありません。
   */
  const [dates, setDates] = useState<EventDate[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  /** イートインだけ・テイクアウトだけに絞る。既定は両方。 */
  const [styleFilter, setStyleFilter] = useState<"all" | DiningStyle>("all");
  const [today, setToday] = useState("");
  /**
   * 開いているまとまり。
   *
   * 当日は20件ほどが並びます。全部を広げたまま出すと、お客様1人ぶんが縦に
   * 4行ずつ積み上がって、目当ての方を探すだけでスクロールし続けることに
   * なります。畳んだ状態では、どなたかを見分けるのに要るもの（お名前・
   * メールアドレス・電話番号・残り件数）だけを出します。
   */
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadOrders();
    // 初回だけ。日を選び直したときは `selectDate` から読み直します。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 今日の分を見ているか。お召し上がり方法を変えられるのは今日だけです。 */
  const isToday = selectedDate !== "" && selectedDate === today;

  /**
   * 受取を記録してよい日か。
   *
   * 今日と、過ぎた日です。**過ぎた日を含めるのは、付け忘れを直すため**。
   * 当日だけにすると「昨日渡したのに受取済にし忘れた」をどこからも直せなく
   * なります（注文一覧からこの操作を外したので、ここが唯一の場所です）。
   *
   * 先の日は入れません。まだ渡していないものに「渡した」と付けられる画面を
   * 用意する理由がありません。
   */
  const canRecordPickup = selectedDate !== "" && selectedDate <= today;

  /**
   * 同じ方の注文をひとまとめにする。まとめるのはメールアドレスか電話番号が
   * 一致したときだけで、氏名ではまとめない（同姓同名の取り違えを防ぐため）。
   */
  const allGroups = useMemo(() => groupByCustomer(orders), [orders]);

  /*
    お召し上がり方法で絞る。

    まとめるのは**絞る前の全部**でやります。絞ったものだけで名寄せすると、
    同姓同名の警告が片方だけ消えたり、まとまりの見分けが変わったりして、
    絞り方ひとつで「誰が誰か」が揺れてしまいます。

    絞るのは、まとまりの中で何を出すかだけ。隠れた注文がある方には、
    その数を出します（`hidden`）。イートインだけを見ている最中に
    「この方はこれで全部」と思い込んで渡し漏らすのを防ぐためです。
  */
  const groups = useMemo(() => {
    if (styleFilter === "all") {
      return allGroups.map((g) => ({ ...g, hidden: 0 }));
    }
    return allGroups
      .map((g) => {
        const kept = g.orders.filter((o) => o.dining_style === styleFilter);
        return { ...g, orders: kept, hidden: g.orders.length - kept.length };
      })
      .filter((g) => g.orders.length > 0);
  }, [allGroups, styleFilter]);

  /** いま画面に出ている注文。合計や受取済みの数はこちらから数えます。 */
  const shownOrders = useMemo(
    () => groups.flatMap((g) => g.orders),
    [groups]
  );

  const eatInCount = orders.filter((o) => o.dining_style === "eat_in").length;
  const takeoutCount = orders.length - eatInCount;

  /**
   * 検索は1件でも当たれば、その方のまとまりごと表示する。
   *
   * お客様が完了メールを1枚だけ見せてこられたとき、その番号で引けば
   * 「他にも2件ありますよ」がその場で分かるようにするため。
   */
  const searching = search.trim().length > 0;

  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;

    return groups.filter((group) =>
      group.orders.some(
        (o) =>
          o.customer_name.toLowerCase().includes(q) ||
          o.order_number.toLowerCase().includes(q) ||
          o.customer_phone.includes(q) ||
          o.customer_email.toLowerCase().includes(q)
      )
    );
  }, [groups, search]);

  /**
   * 見る日を変える。
   *
   * 畳んだ状態に戻してから読み直します。前の日で開いていたまとまりが
   * そのまま開いているように見えると、別の日の内容と取り違えます。
   */
  function selectDate(date: string) {
    if (date === selectedDate) return;
    setOpenGroups(new Set());
    setSearch("");
    setStyleFilter("all");
    setLoading(true);
    loadOrders(date);
  }

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function loadOrders(date?: string) {
    setLoadError("");
    try {
      const data = await fetchJson<{
        orders: PickupOrder[];
        dates: EventDate[];
        today: string;
        selected_date: string;
      }>(`/api/admin/pickup${date ? `?date=${encodeURIComponent(date)}` : ""}`);
      setOrders(data.orders);
      setDates(data.dates ?? []);
      setToday(data.today);
      setSelectedDate(data.selected_date);
    } catch (err) {
      console.error("Pickup load error:", err);
      setLoadError(
        err instanceof ApiError ? err.message : "サーバーとの通信に失敗しました"
      );
    } finally {
      setLoading(false);
    }
  }

  async function setPickupStatus(
    orderId: string,
    status: "picked_up" | "not_picked_up"
  ) {
    setUpdatingId(orderId);
    try {
      await fetchJson(`/api/admin/orders/${orderId}/pickup`, {
        method: "PATCH",
        body: JSON.stringify({ pickup_status: status }),
      });

      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, pickup_status: status } : o))
      );
    } catch (err) {
      console.error("Pickup update error:", err);
      alert("受取ステータスの更新に失敗しました");
    } finally {
      setUpdatingId(null);
    }
  }

  const markPickedUp = (orderId: string) =>
    setPickupStatus(orderId, "picked_up");

  const markNotPickedUp = (orderId: string) =>
    setPickupStatus(orderId, "not_picked_up");

  /** まとまりの残りをまとめてお渡し済みにする。 */
  async function markGroupPickedUp(groupOrders: PickupOrder[]) {
    const remaining = groupOrders.filter(
      (o) => o.pickup_status !== "picked_up"
    );
    for (const order of remaining) {
      await setPickupStatus(order.id, "picked_up");
    }
  }

  /**
   * カウンターで店内／持ち帰りを切り替える。
   *
   * 消費税率は「お渡しした時点」の意思で決まるので、ここで直したものが正。
   * 売値は同じなので、決済済みでも金額は動かない。
   */
  async function changeDiningStyle(orderId: string, next: DiningStyle) {
    setUpdatingId(orderId);
    try {
      await fetchJson(`/api/admin/orders/${orderId}/dining-style`, {
        method: "PATCH",
        body: JSON.stringify({ dining_style: next }),
      });

      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, dining_style: next } : o))
      );
    } catch (err) {
      console.error("Dining style update error:", err);
      alert(
        err instanceof ApiError
          ? err.message
          : "お召し上がり方法の変更に失敗しました"
      );
    } finally {
      setUpdatingId(null);
    }
  }

  const totalCount = shownOrders.length;
  const pickedUpCount = shownOrders.filter(
    (o) => o.pickup_status === "picked_up"
  ).length;
  const remainingCount = totalCount - pickedUpCount;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">読み込み中...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <LoadErrorNotice
        message={loadError}
        onRetry={() => {
          setLoading(true);
          loadOrders(selectedDate || undefined);
        }}
      />
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 mb-1">
        {isToday ? "本日の受取管理" : "受取管理"}
      </h2>
      {selectedDate && (
        <p className="mb-4 text-sm text-slate-500">
          {formatDate(selectedDate)}
          {isToday && <span className="ml-2 font-medium text-indigo-700">本日</span>}
        </p>
      )}

      {/*
        受取日を選ぶ。

        既定は今日です。先の日を開けるのは、**仕込みの前にその日の受け渡しを
        見ておく**ためで、まだ来ていない方に「渡した」と付ける画面では
        ありません。当日以外は受取完了も区分の変更も出しません。

        横に並べて、はみ出したぶんは横スクロールにします。会期は2週間ほど
        あり、縦に積むと本題の一覧が画面の下に追いやられます。
      */}
      {dates.length > 1 && (
        <div className="mb-6 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {dates.map((d) => {
            const active = d.pickup_date === selectedDate;
            const isTodayChip = d.pickup_date === today;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => selectDate(d.pickup_date)}
                aria-current={active ? "date" : undefined}
                className={`shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "border-indigo-500 bg-indigo-600 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {formatDate(d.pickup_date)}
                {isTodayChip && (
                  <span
                    className={`ml-1.5 text-xs ${
                      active ? "text-indigo-100" : "text-indigo-600"
                    }`}
                  >
                    本日
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {!isToday && selectedDate && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {canRecordPickup ? (
            <>
              <span className="font-medium">過ぎた日を見ています。</span>
              付け忘れた受取を、ここで記録できます。
            </>
          ) : (
            <>
              <span className="font-medium">先の日を見ています。</span>
              どなたが何件取りに来られるかの確認用です。受取完了やお召し上がり
              方法の変更は、その日になってから行えます。
            </>
          )}
        </div>
      )}

      {/*
        その日の数。

        当日は「あと何件渡すか」が知りたいので、受取済みと残りを出します。
        先の日は全部が未受取なので、同じ3つを出しても意味がありません。
        仕込みのために知りたいのは**何組のお客様が何件取りに来るか**なので、
        そちらに差し替えます。
      */}
      {canRecordPickup ? (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
            <p className="text-xs text-slate-500">合計</p>
            <p className="text-2xl font-bold text-slate-800">{totalCount}</p>
          </div>
          <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4 text-center">
            <p className="text-xs text-emerald-600">受取済み</p>
            <p className="text-2xl font-bold text-emerald-700">{pickedUpCount}</p>
          </div>
          <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 text-center">
            <p className="text-xs text-amber-600">残り</p>
            <p className="text-2xl font-bold text-amber-700">{remainingCount}</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
            <p className="text-xs text-slate-500">ご予約</p>
            <p className="text-2xl font-bold text-slate-800">{totalCount} 件</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
            <p className="text-xs text-slate-500">お客様</p>
            <p className="text-2xl font-bold text-slate-800">{groups.length} 組</p>
          </div>
        </div>
      )}

      {/*
        お召し上がり方法で絞る。

        仕込みでは「イートインが何人ぶん」が要りますし、当日は席に出す分と
        袋に詰める分を分けて数えたくなります。数を札に出しておくのは、
        押さなくても分かるようにするためです。
      */}
      {orders.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {(
            [
              ["all", "すべて", orders.length],
              ["eat_in", "イートイン", eatInCount],
              ["takeout", "テイクアウト", takeoutCount],
            ] as const
          ).map(([value, label, count]) => {
            const active = styleFilter === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setStyleFilter(value)}
                aria-pressed={active}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "border-indigo-500 bg-indigo-600 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {label}
                <span
                  className={`ml-1.5 text-xs ${
                    active ? "text-indigo-100" : "text-slate-400"
                  }`}
                >
                  {count}件
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="名前・注文番号・電話番号で検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none"
        />
      </div>

      {/* Progress bar — 渡し始める当日だけ。先の日はいつも 0% です。 */}
      {canRecordPickup && totalCount > 0 && (
        <div className="mb-6">
          <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${(pickedUpCount / totalCount) * 100}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 mt-1 text-right">
            {Math.round((pickedUpCount / totalCount) * 100)}% 完了
          </p>
        </div>
      )}

      {/* まとまりごとの一覧 */}
      <div className="space-y-3">
        {visibleGroups.map((group) => {
          const groupOrders = group.orders;
          const done = groupOrders.filter(
            (o) => o.pickup_status === "picked_up"
          ).length;
          const allDone = done === groupOrders.length;
          const remaining = groupOrders.length - done;
          const groupTotal = groupOrders.reduce(
            (sum, o) => sum + o.total_amount,
            0
          );
          const groupItems = groupOrders.reduce(
            (sum, o) =>
              sum +
              (o.order_items ?? []).reduce((n, item) => n + item.quantity, 0),
            0
          );
          const head = groupOrders[0];
          const multiple = groupOrders.length > 1;
          /*
            検索しているあいだは開いたままにする。お客様が完了メールを見せて
            こられて番号で引いたのに、もう一度押さないと中身が見えないのでは
            一手増えるだけです。
          */
          const isOpen = searching || openGroups.has(group.key);

          return (
            <div
              key={group.key}
              data-pickup-group={group.key}
              className={`rounded-xl border bg-white transition-all ${
                allDone ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200"
              }`}
            >
              {/*
                お客様。ここを押すと中身が開く。

                畳んでいても出しておくのは、どなたかを見分けるのに要るものだけ:
                お名前・連絡先・残り件数、そして**同姓同名の警告**。警告を
                クリックの向こうに隠すと、開かずに渡してしまう事故が起きます。
              */}
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                aria-expanded={isOpen}
                className={`w-full px-4 pt-4 pb-3 text-left transition-colors hover:bg-slate-50 ${
                  isOpen ? "border-b border-slate-100" : ""
                }`}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span
                    aria-hidden
                    className={`text-slate-400 transition-transform ${
                      isOpen ? "rotate-90" : ""
                    }`}
                  >
                    ▶
                  </span>
                  <span className="text-lg font-bold text-slate-800">
                    {head.customer_name}
                  </span>
                  {multiple && (
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700">
                      {groupOrders.length}件まとめ
                    </span>
                  )}
                  {/*
                    絞り込みで隠れている注文があることを、必ず言う。

                    イートインだけを見ているときに「この方はこれで全部」と
                    思い込むと、袋のほうを渡し忘れます。
                  */}
                  {group.hidden > 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                      他に{group.hidden}件
                    </span>
                  )}
                  <span
                    className={`ml-auto text-sm font-medium ${
                      allDone ? "text-emerald-700" : "text-amber-700"
                    }`}
                  >
                    {done}/{groupOrders.length} 受取済
                  </span>
                </div>

                <p className="mt-1 text-xs text-slate-500">
                  {head.customer_email}
                  {head.customer_phone ? ` ・ ${head.customer_phone}` : ""}
                </p>

                {/*
                  まとめた理由をその場に書く。黙ってまとめるのがいちばん危ない。
                  スタッフが「なぜ一緒になっているのか」を一目で判断できること。
                */}
                {multiple && (
                  <p className="mt-0.5 text-xs text-indigo-600">
                    └ {matchedByLabel(group.matchedBy)}
                  </p>
                )}

                {/*
                  同姓同名の別の方がいる場合の警告。連絡先が違えば別人として
                  扱うので、取り違えを防げるのはこの一行だけ。畳んでいても出す。
                */}
                {group.hasNameCollision && (
                  <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                    ⚠ 同じ「{head.customer_name}」様が他にもいらっしゃいます。
                    連絡先が異なるため、別の方として表示しています。注文番号をご確認ください。
                  </p>
                )}
              </button>

              {/* 注文（まとめても1件ずつ見せる） */}
              <div className="divide-y divide-slate-100" hidden={!isOpen}>
                {groupOrders.map((order) => {
                  const isPickedUp = order.pickup_status === "picked_up";
                  const busy = updatingId === order.id;

                  return (
                    <div
                      key={order.id}
                      data-order-row={order.order_number}
                      className="flex flex-wrap items-start gap-3 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-slate-500">
                            {order.order_number}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs font-bold ${
                              order.dining_style === "eat_in"
                                ? "bg-rose-100 text-rose-700"
                                : "bg-sky-100 text-sky-700"
                            }`}
                          >
                            {diningStyleLabel(order.dining_style)}
                          </span>
                          {isPickedUp && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                              受取済
                            </span>
                          )}
                        </div>

                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {order.order_items?.map((item) => (
                            <span
                              key={item.id}
                              className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700"
                            >
                              {item.product_name_snapshot} x{item.quantity}
                            </span>
                          ))}
                        </div>

                        <p className="mt-1.5 text-sm font-medium text-slate-700">
                          {formatPrice(order.total_amount)}
                          <span className="ml-2 text-xs font-normal text-slate-400">
                            ({order.payment_method === "cash" ? "現地払い" : "カード"}{" "}
                            / {order.payment_status === "paid" ? "決済済み" : "未決済"})
                          </span>
                        </p>

                        {/*
                          当日の切り替え。売値は変わらないので、決済済みでも
                          押せる。渡したあとでも直せるようにしてある。

                          先の日では出しません。お客様が目の前にいて初めて
                          決まることなので、前もって決めておくものではない。
                        */}
                        {isToday && (
                          <button
                            onClick={() =>
                              changeDiningStyle(
                                order.id,
                                order.dining_style === "eat_in" ? "takeout" : "eat_in"
                              )
                            }
                            disabled={busy}
                            className="mt-1.5 text-xs font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-800 disabled:opacity-50"
                          >
                            {order.dining_style === "eat_in"
                              ? "テイクアウトに変更"
                              : "イートインに変更"}
                          </button>
                        )}
                      </div>

                      <div className="shrink-0">
                        {!canRecordPickup ? null : isPickedUp ? (
                          <button
                            onClick={() => markNotPickedUp(order.id)}
                            disabled={busy}
                            className="rounded-lg bg-slate-200 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-300 disabled:opacity-50"
                          >
                            {busy ? "..." : "取消"}
                          </button>
                        ) : (
                          <button
                            onClick={() => markPickedUp(order.id)}
                            disabled={busy}
                            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {busy ? "処理中..." : "受取完了"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* まとめ */}
              {multiple && isOpen && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
                  <p className="text-sm text-slate-600">
                    合計 {groupItems} 点
                    <span className="ml-2 font-bold text-slate-800">
                      {formatPrice(groupTotal)}
                    </span>
                  </p>
                  {canRecordPickup && remaining > 0 && (
                    <button
                      onClick={() => markGroupPickedUp(groupOrders)}
                      disabled={updatingId !== null}
                      className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
                    >
                      残り{remaining}件をまとめて受取完了
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {visibleGroups.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            {orders.length === 0
              ? isToday
                ? "本日の受取予約はありません"
                : "この日の受取予約はまだありません"
              : "該当する注文が見つかりません"}
          </div>
        )}
      </div>
    </div>
  );
}
