import { Fragment } from "react";
import Image from "next/image";
import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { Icon } from "@/components/Icon";
import { getActiveEventWithDates } from "@/lib/queries";
import type { EventDate } from "@/lib/types";
import {
  effectiveReservationStatus,
  formatDate,
  getStatusLabel,
} from "@/lib/utils";

// Availability changes as orders come in, so never serve this from the cache.
export const dynamic = "force-dynamic";

/**
 * 見出しの左右に置くロゴ。
 *
 * `filled` は「渡した画像がすでに丸い」という意味です。ゲゲゲ忌の
 * ロゴは珊瑚色の円そのものなので、白い円に載せると外側に白い輪が
 * できてしまいます。その場合は枠を敷かず、画像で円を埋めます。
 */
function LogoBadge({
  src,
  alt,
  width,
  height,
  filled = false,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  filled?: boolean;
}) {
  return (
    <span
      className={`flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full sm:h-20 sm:w-20 ${
        filled ? "" : "bg-white p-1.5 sm:p-2.5"
      }`}
    >
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        priority
        className="h-full w-full object-contain"
      />
    </span>
  );
}

export default async function EventTopPage() {
  const event = await getActiveEventWithDates();

  if (!event) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-paper px-4">
        <div className="text-center">
          <Icon name="coffee" className="w-14 h-14 mx-auto mb-4 text-zinc-300" />
          <h1 className="text-xl font-bold text-zinc-700 mb-2">
            現在開催中のイベントはありません
          </h1>
          <p className="text-zinc-500">
            次回のイベントをお楽しみに！
          </p>
        </div>
      </main>
    );
  }

  const dates = event.event_dates as EventDate[];

  return (
    <main className="min-h-screen bg-white">
      {/* The shop first, then the event — people come here from その店の告知 */}
      <header className="bg-white">
        <div className="mx-auto flex max-w-lg justify-center px-4 py-2">
          <Image
            src="/logo.png"
            alt="となりのと commons kitchen"
            width={931}
            height={977}
            priority
            className="h-20 w-auto"
          />
        </div>
      </header>

      {/*
        ここから下、フッターの手前までが青地です。

        以前は見出しのまわりだけを青にして、受取日は落ち着いた白地に置いて
        いました。お店の希望で、**上のロゴの下から下のロゴの上まで**を一枚の
        青にします。紙のチラシと同じ見え方にしたい、という意図です。

        そのぶん、青に乗る文字は白に起こす必要があります（見出し・補足文・
        日程なしの案内）。白いカードの中身は今までどおりです。
      */}
      <div className="bg-fes-navy text-white">
        <div className="mx-auto max-w-5xl px-4 pt-8 pb-6 sm:pt-10">
          {/*
            店のロゴ・催しの名前・ゲゲゲ忌のロゴを横一列に。

            狭い画面では丸が小さくなり、名前は2行に折り返します。丸は
            縮めない（`shrink-0`）かわりに、名前のほうを縮めます。
          */}
          <div className="flex items-center justify-center gap-2.5 sm:gap-6">
            <LogoBadge
              src="/logo.png"
              alt="となりのと commons kitchen"
              width={931}
              height={977}
            />
            <h1 className="min-w-0 text-center text-[clamp(1.2rem,5.5vw,2.75rem)] font-extrabold leading-[1.2] text-fes-coral [overflow-wrap:break-word] [word-break:keep-all]">
              {/*
                折り返してよい場所を、こちらから決めます。

                日本語は本来どの文字と文字のあいだでも改行できます。その
                ままだと「ゲゲゲ忌2026コラボメ／ニュー」のように語の途中で
                割れました。催しの名前が割れると読み違えられます。

                `word-break: keep-all` で自動の切れ目を全部止めたうえで、
                **数字のかたまりの前後にだけ** `<wbr>` を置きます。
                「ゲゲゲ忌2026コラボメニュー」なら「ゲゲゲ忌2026」で折れて
                「コラボメニュー」が次の行に落ちます。お店が名前に空白を
                入れていなくても効くので、データに手を入れずに済みます。

                `<wbr>` は**折れてよい場所**を示すだけで、空白にはなりません。
                PC のように1行に収まる幅では、今までどおり1行のままです。

                どうしても収まらないとき（極端に狭い画面）だけは、
                `overflow-wrap: break-word` が最後の逃げ道になって、
                はみ出すかわりにそこで折ります。
              */}
              {event.name
                .split(/(\d+)/)
                .filter(Boolean)
                .map((part, i) => (
                  <Fragment key={i}>
                    {i > 0 && <wbr />}
                    {part}
                  </Fragment>
                ))}
            </h1>
            <LogoBadge
              src="/gegege-ki-logo.png"
              alt="ゲゲゲ忌 水木マンガの生まれた街 調布"
              width={400}
              height={400}
              filled
            />
          </div>

          {/*
            その日のお皿を一枚で。

            商品を丸く並べていたところです。品書きは受取日を選んだ先に
            あるので、ここで全部見せる必要はありません。背景を抜いた
            写真なので、青地にそのまま乗ります。
          */}
          <Image
            src="/gegege-2026-dishes.png"
            alt="ゲゲゲ忌2026 コラボメニューの料理"
            width={1032}
            height={963}
            priority
            sizes="(min-width: 640px) 34rem, 100vw"
            className="mx-auto mt-6 h-auto w-full max-w-[34rem]"
          />

          {event.description && (
            <p className="mx-auto mt-5 max-w-xl text-center text-sm leading-relaxed text-white/85">
              {event.description}
            </p>
          )}
        </div>

        {/*
          PCでは「催しの案内」と「受取日」を横に並べます。1列のまま伸ばすと、
          広い画面で1行が長くなりすぎて読みにくく、受取日も画面の下に
          落ちてしまいます。選ぶものが最初から見えているほうがよい。
        */}
        <div className="mx-auto grid max-w-5xl gap-6 px-4 pb-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start lg:gap-8">
          {/* Info Card */}
          {/*
            PCでは、スクロールしてもここだけ残します。受取日を選ぶあいだ、
            締切や受取場所が見えているように。

            高さには蓋をします。「ご注意」はお店が自由に書ける欄で、画面より
            高くなると**追従したまま下が読めなくなる**からです。そうなった
            ときだけ、この中だけでスクロールします。
          */}
          <div className="rounded-2xl bg-white p-5 shadow-lg lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Icon name="calendar" className="w-4 h-4 text-brand-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-zinc-400 font-medium mb-0.5">
                    開催期間
                  </p>
                  <p className="text-zinc-800 font-medium">
                    {formatDate(event.start_date)} 〜 {formatDate(event.end_date)}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Icon name="pin" className="w-4 h-4 text-brand-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-zinc-400 font-medium mb-0.5">
                    受取場所
                  </p>
                  <p className="text-zinc-800 font-medium">
                    {event.pickup_location}
                  </p>
                </div>
              </div>
              {event.reservation_note && (
                <div className="flex items-start gap-3">
                  <Icon name="note" className="w-4 h-4 text-brand-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-zinc-400 font-medium mb-0.5">
                      ご注意
                    </p>
                    <p className="text-zinc-600 text-sm leading-relaxed whitespace-pre-line">
                      {event.reservation_note}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Date Selection - Click to Reserve */}
          {dates.length > 0 && (
            <div>
              {/* 青地に乗るので、見出しと補足は白で起こします。 */}
              <h2 className="mb-1 text-lg font-bold text-white">
                受取日を選んで予約
              </h2>
              <p className="mb-4 text-xs text-white/75">
                ご希望の受取日をタップすると、商品選択に進みます。
              </p>
              <div className="space-y-3">
                {dates.map((d) => {
                  // A date past its deadline reads as closed whatever is
                  // stored, so nothing has to run on a schedule to shut it.
                  const reservationStatus = effectiveReservationStatus(d);
                  const status = getStatusLabel(reservationStatus);
                  const isClickable =
                    reservationStatus === "open" ||
                    reservationStatus === "few_left";
                  const dayNum = new Date(d.pickup_date + "T00:00:00").getDate();

                  if (!isClickable) {
                    return (
                      <div
                        key={d.id}
                        className="w-full rounded-2xl bg-zinc-100 p-4 opacity-60 cursor-not-allowed"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-xl bg-zinc-200 text-zinc-400 flex items-center justify-center text-lg font-bold">
                              {dayNum}
                            </div>
                            <div>
                              <p className="font-bold text-base text-zinc-400">
                                {formatDate(d.pickup_date)}
                              </p>
                              <p className="text-xs text-zinc-400 mt-0.5">受取日</p>
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
                      className="block w-full rounded-2xl bg-white p-4 shadow-sm transition-all hover:shadow-lg active:scale-[0.98]"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-lg font-bold text-brand-700">
                            {dayNum}
                          </div>
                          <div>
                            <p className="font-bold text-base text-zinc-800">
                              {formatDate(d.pickup_date)}
                            </p>
                            <p className="text-xs text-zinc-400 mt-0.5">受取日</p>
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
                            className="h-4 w-4 text-zinc-300"
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
            <div className="py-8 text-center text-white/75">
              <Icon name="calendar" className="w-10 h-10 mx-auto mb-3 text-white/40" />
              <p>予約可能な日程がまだありません</p>
            </div>
          )}
        </div>
      </div>

      {/* ここから下は白地に戻ります。ラフの「下のロゴ上まで」が青の終わり。 */}
      <div className="mx-auto max-w-5xl px-4">
        <SiteFooter />
      </div>
    </main>
  );
}
