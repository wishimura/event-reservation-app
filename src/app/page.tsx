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

        {/* Date Cards */}
        {dates.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-bold text-stone-500 uppercase tracking-wider mb-3">
              受取日一覧
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {dates.map((d) => {
                const status = getStatusLabel(d.reservation_status);
                return (
                  <div
                    key={d.id}
                    className="bg-white rounded-xl border border-stone-200 p-3 flex items-center justify-between"
                  >
                    <span className="text-stone-800 font-semibold text-sm">
                      {formatDate(d.pickup_date)}
                    </span>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${status.color}`}
                    >
                      {status.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="pb-10">
          <Link
            href="/reserve"
            className="block w-full text-center bg-amber-700 hover:bg-amber-800 active:bg-amber-900 text-white font-bold py-4 rounded-2xl text-lg shadow-lg shadow-amber-700/20 transition-colors"
          >
            予約する
          </Link>
        </div>
      </div>
    </main>
  );
}
