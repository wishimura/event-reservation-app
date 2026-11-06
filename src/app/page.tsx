import Image from "next/image";
import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { Icon } from "@/components/Icon";
import { getActiveEventWithDates, getEventShowcase } from "@/lib/queries";
import type { EventDate } from "@/lib/types";
import {
  effectiveReservationStatus,
  formatDate,
  formatPrice,
  getStatusLabel,
} from "@/lib/utils";

// Availability changes as orders come in, so never serve this from the cache.
export const dynamic = "force-dynamic";

/**
 * 丸く切り抜いた料理1品。
 *
 * 写真は商品マスタのものです。正方形に切ってから丸くするので、縦長・横長の
 * 写真は端が落ちます。うまく収まらない商品は、商品マスタで**真ん中に寄せた
 * 写真**に差し替えてください（詳細の写真は何枚でも足せます）。
 */
function ShowcaseDish({
  dish,
}: {
  dish: { id: string; name: string; price: number; image_url: string | null };
}) {
  return (
    <figure className="m-0 min-w-0 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={dish.image_url!}
        alt={dish.name}
        loading="lazy"
        className="aspect-square w-full rounded-full object-cover shadow-lg ring-[3px] ring-fes-cream"
      />
      <figcaption className="mt-2 text-[11px] font-medium leading-snug text-white sm:text-xs">
        {/*
          名前は2行まで。本番には「一反もめんナン＆カレー1種（バターチキン）
          セット」のような長い名前があり、そのまま出すと1つだけ背が高くなって
          列が揃いません。全部はここで読ませなくてよく、押せば詳細に出ます。
        */}
        <span className="line-clamp-2">{dish.name}</span>
        <span className="mt-0.5 block font-bold text-sun-300">
          {formatPrice(dish.price)}
        </span>
      </figcaption>
    </figure>
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
  const showcase = await getEventShowcase(event.id);

  /*
    上段に大きく3品、下段に小さく4品。**7品まで**。

    全部同じ大きさだと、どれから見ればいいのか分からなくなります。
    全部出すのも違う——10品を丸で並べると、青い帯がそれだけで画面を
    埋めてしまい、肝心の受取日が下に消えます。ここは品書きではなく
    「こういう催しです」と伝える入口なので、顔ぶれが分かれば足ります。

    どの7品かは、商品マスタの並び順の先頭からです。出したいものを
    上に並べてください。
  */
  const featured = showcase.slice(0, 3);
  const rest = showcase.slice(3, 7);

  return (
    <main className="min-h-screen bg-paper">
      {/* The shop first, then the event — people come here from その店の告知 */}
      <header className="bg-white">
        <div className="mx-auto flex max-w-lg justify-center px-4 py-6">
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
        催しの入口。

        ここだけポスターと同じ紺・朱でいきます。受取日から先は落ち着いた
        ままです（`globals.css` の fes-* の注を参照）。
      */}
      <div className="bg-fes-navy text-white">
        <div className="mx-auto max-w-5xl px-4 pt-9 pb-8 text-center">
          <p className="mb-2 text-xs font-medium tracking-[0.3em] text-white/75">
            CAFE EVENT
          </p>
          <h1 className="text-balance text-[clamp(1.9rem,7vw,3.25rem)] font-extrabold leading-[1.15] text-fes-coral">
            {event.name}
          </h1>
          {event.description && (
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-white/85">
              {event.description}
            </p>
          )}
        </div>

        {/*
          料理の写真を丸く並べる。

          写真は商品マスタのものをそのまま使うので、商品を入れ替えれば
          ここも変わります。丸の外に白い輪を一枚回してあるのは、紺から
          浮かせるためです。
        */}
        {showcase.length > 0 && (
          <div className="mx-auto max-w-5xl px-4 pb-10">
            {/*
              上に3つ、下に4つ。**幅に関わらず、その割り付けを崩さない。**

              はじめは円を固定ピクセルで置いて折り返させていましたが、
              iPhone の標準幅（390px）では上段の3つすら入らず、2+1+3+1 に
              割れました。並びが崩れると、どれが主役なのか分からなくなります。
              円の大きさのほうを画面に合わせます。
            */}
            <div className="mx-auto grid max-w-[26rem] grid-cols-3 gap-x-4 gap-y-6">
              {featured.map((p) => (
                <ShowcaseDish key={p.id} dish={p} />
              ))}
            </div>
            {rest.length > 0 && (
              <div className="mx-auto mt-6 grid max-w-[26rem] grid-cols-4 gap-x-3 gap-y-6">
                {rest.map((p) => (
                  <ShowcaseDish key={p.id} dish={p} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/*
        ここから下は落ち着いた側。

        PCでは「催しの案内」と「受取日」を横に並べます。1列のまま伸ばすと、
        広い画面で1行が長くなりすぎて読みにくく、受取日も画面の下に
        落ちてしまいます。選ぶものが最初から見えているほうがよい。
      */}
      {/*
        青と白をきれいに分ける。

        以前は白いカードを青帯に食い込ませていました（-mt-4）。見た目の
        重なりは悪くないのですが、PCではそのカードが追従して止まるので、
        **青の上に乗っていたものが途中で白の中に収まる**という動き方になり、
        スクロールのたびに落ち着かない。境目をまたがせないほうが素直です。

        PCでは「催しの案内」と「受取日」を横に並べます。1列のまま伸ばすと、
        広い画面で1行が長くなりすぎて読みにくく、受取日も下に落ちます。
      */}
      <div className="mx-auto grid max-w-5xl gap-6 px-4 pt-7 pb-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start lg:gap-8">
        {/* Info Card */}
        {/*
          PCでは、スクロールしてもここだけ残します。受取日を選ぶあいだ、
          締切や受取場所が見えているように。

          高さには蓋をします。「ご注意」はお店が自由に書ける欄で、画面より
          高くなると**追従したまま下が読めなくなる**からです。そうなった
          ときだけ、この中だけでスクロールします。
        */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">
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
            <h2 className="mb-1 text-lg font-bold text-fes-navy">
              受取日を選んで予約
            </h2>
            <p className="mb-4 text-xs text-zinc-500">
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
                      className="w-full rounded-2xl border border-zinc-200 bg-zinc-100 p-4 opacity-60 cursor-not-allowed"
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
                    className="block w-full rounded-2xl border border-zinc-200 bg-white p-4 hover:border-brand-400 hover:shadow-md active:scale-[0.98] transition-all"
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
          <div className="text-center py-8 text-zinc-400">
            <Icon name="calendar" className="w-10 h-10 mx-auto mb-3 text-zinc-300" />
            <p>予約可能な日程がまだありません</p>
          </div>
        )}

      </div>

      <div className="mx-auto max-w-5xl px-4">
        <SiteFooter />
      </div>
    </main>
  );
}
