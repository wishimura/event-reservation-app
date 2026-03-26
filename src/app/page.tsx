import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { Event, EventDate } from "@/lib/types";
import { formatDate, getStatusLabel } from "@/lib/utils";

export default async function EventTopPage() {
  const { data: event } = await supabase
    .from("events")
    .select("*")
    .eq("is_active", true)
    .single<Event>();

  const { data: eventDates } = await supabase
    .from("event_dates")
    .select("*")
    .eq("event_id", event?.id ?? "")
    .eq("is_active", true)
    .order("pickup_date");

  if (!event) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-stone-50 px-4">
        <div className="text-center">
          <p className="text-6xl mb-4">&#9749;</p>
          <h1 className="text-xl font-bold text-stone-700 mb-2">
            現在開催中のイベントはありません
          </h1>
          <p className="text-stone-500">
            次回のイベントをお楽しみに！
          </p>
        </div>
      </main>
    );
  }

  const dates = (eventDates ?? []) as EventDate[];

  return (
    <main className="min-h-screen bg-stone-50">
      {/* Hero */}
      <div className="bg-gradient-to-br from-amber-800 via-amber-900 to-stone-900 text-white">
        <div className="max-w-lg mx-auto px-4 pt-12 pb-10">
          <p className="text-amber-300 text-sm font-medium tracking-wider mb-2">
            &#9749; CAFE EVENT
          </p>
          <h1 className="text-3xl font-bold leading-tight mb-3">
            {event.name}
          </h1>
          <p className="text-amber-100/80 text-sm leading-relaxed">
            {event.description}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-lg mx-auto px-4 -mt-4">
        {/* Info Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-5 mb-6">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <span className="text-amber-600 mt-0.5">&#128197;</span>
              <div>
                <p className="text-xs text-stone-400 font-medium mb-0.5">
                  開催期間
                </p>
                <p className="text-stone-800 font-medium">
                  {formatDate(event.start_date)} 〜 {formatDate(event.end_date)}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-amber-600 mt-0.5">&#128205;</span>
              <div>
                <p className="text-xs text-stone-400 font-medium mb-0.5">
                  受取場所
                </p>
                <p className="text-stone-800 font-medium">
                  {event.pickup_location}
                </p>
              </div>
            </div>
            {event.reservation_note && (
              <div className="flex items-start gap-3">
                <span className="text-amber-600 mt-0.5">&#128221;</span>
                <div>
                  <p className="text-xs text-stone-400 font-medium mb-0.5">
                    ご注意
                  </p>
                  <p className="text-stone-600 text-sm leading-relaxed whitespace-pre-line">
                    {event.reservation_note}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Date Selection - Click to Reserve */}
        {dates.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-bold text-stone-500 uppercase tracking-wider mb-3">
              受取日を選んで予約
            </h2>
            <p className="text-xs text-stone-400 mb-4">
              ご希望の受取日をタップすると、商品選択に進みます。
            </p>
            <div className="space-y-3">
              {dates.map((d) => {
                const status = getStatusLabel(d.reservation_status);
                const isClickable =
                  d.reservation_status === "open" ||
                  d.reservation_status === "few_left";
                const dayNum = new Date(d.pickup_date + "T00:00:00").getDate();

                if (!isClickable) {
                  return (
                    <div
                      key={d.id}
                      className="w-full rounded-2xl border border-stone-200 bg-stone-100 p-4 opacity-60 cursor-not-allowed"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-xl bg-stone-200 text-stone-400 flex items-center justify-center text-lg font-bold">
                            {dayNum}
                          </div>
                          <div>
                            <p className="font-bold text-base text-stone-400">
                              {formatDate(d.pickup_date)}
                            </p>
                            <p className="text-xs text-stone-400 mt-0.5">受取日</p>
                          </div>
                        </div>
                        <span
                          className={`text-xs font-semibold px-3 py-1 rounded-full ${status.color}`}
                        >
                          {status.label}
                        </span>
                      </div>
                    </div>
                  );
                }

                return (
                  <Link
                    key={d.id}
                    href={`/reserve/${d.id}`}
                    className="block w-full rounded-2xl border border-stone-200 bg-white p-4 hover:border-amber-400 hover:shadow-md active:scale-[0.98] transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center text-lg font-bold">
                          {dayNum}
                        </div>
                        <div>
                          <p className="font-bold text-base text-stone-800">
                            {formatDate(d.pickup_date)}
                          </p>
                          <p className="text-xs text-stone-400 mt-0.5">受取日</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-semibold px-3 py-1 rounded-full ${status.color}`}
                        >
                          {status.label}
                        </span>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4 text-stone-300"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {dates.length === 0 && (
          <div className="text-center py-8 text-stone-400 mb-6">
            <p className="text-4xl mb-3">&#128197;</p>
            <p>予約可能な日程がまだありません</p>
          </div>
        )}
      </div>
    </main>
  );
}
