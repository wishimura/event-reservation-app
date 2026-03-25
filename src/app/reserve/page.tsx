"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { Event, EventDate } from "@/lib/types";
import { formatDate, getStatusLabel } from "@/lib/utils";

export default function DateSelectionPage() {
  const router = useRouter();
  const [event, setEvent] = useState<Event | null>(null);
  const [dates, setDates] = useState<EventDate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const { data: ev } = await supabase
        .from("events")
        .select("*")
        .eq("is_active", true)
        .single<Event>();

      if (!ev) {
        setLoading(false);
        return;
      }
      setEvent(ev);

      const { data: eventDates } = await supabase
        .from("event_dates")
        .select("*")
        .eq("event_id", ev.id)
        .eq("is_active", true)
        .order("pickup_date");

      setDates((eventDates ?? []) as EventDate[]);
      setLoading(false);
    }
    fetchData();
  }, []);

  function handleDateSelect(d: EventDate) {
    if (d.reservation_status === "closed") return;
    localStorage.setItem(
      "selectedDate",
      JSON.stringify({ id: d.id, pickup_date: d.pickup_date })
    );
    router.push(`/reserve/${d.id}`);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="animate-pulse text-stone-400">読み込み中...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href="/"
            className="text-stone-400 hover:text-stone-600 transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </Link>
          <h1 className="text-lg font-bold text-stone-800">
            受取日を選択
          </h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Instructions */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <p className="text-amber-800 text-sm leading-relaxed">
            &#128197; ご希望の受取日をお選びください。受付中の日程のみ予約が可能です。
          </p>
        </div>

        {event && (
          <p className="text-xs text-stone-400 mb-2">
            {event.name}
          </p>
        )}

        {/* Date Grid */}
        <div className="space-y-3">
          {dates.map((d) => {
            const status = getStatusLabel(d.reservation_status);
            const isClickable =
              d.reservation_status === "open" ||
              d.reservation_status === "few_left";

            return (
              <button
                key={d.id}
                onClick={() => handleDateSelect(d)}
                disabled={!isClickable}
                className={`w-full text-left rounded-2xl border p-4 transition-all ${
                  isClickable
                    ? "bg-white border-stone-200 hover:border-amber-400 hover:shadow-md active:scale-[0.98] cursor-pointer"
                    : "bg-stone-100 border-stone-200 opacity-60 cursor-not-allowed"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold ${
                        isClickable
                          ? "bg-amber-100 text-amber-800"
                          : "bg-stone-200 text-stone-400"
                      }`}
                    >
                      {new Date(d.pickup_date + "T00:00:00").getDate()}
                    </div>
                    <div>
                      <p
                        className={`font-bold text-base ${
                          isClickable ? "text-stone-800" : "text-stone-400"
                        }`}
                      >
                        {formatDate(d.pickup_date)}
                      </p>
                      <p className="text-xs text-stone-400 mt-0.5">
                        受取日
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-semibold px-3 py-1 rounded-full ${status.color}`}
                    >
                      {status.label}
                    </span>
                    {isClickable && (
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
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {dates.length === 0 && (
          <div className="text-center py-12 text-stone-400">
            <p className="text-4xl mb-3">&#128197;</p>
            <p>予約可能な日程がありません</p>
          </div>
        )}
      </div>
    </main>
  );
}
