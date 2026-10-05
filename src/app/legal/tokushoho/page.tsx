import Link from "next/link";

/**
 * 特定商取引法に基づく表記
 *
 * Required once the site takes payment online. Content is edited here rather
 * than in the database: it changes rarely, and it has to be reviewable in the
 * repository alongside the code that takes the money.
 *
 * ★ 下の ENTRIES は、公開情報（店舗情報・法人登記）から組んだ仮の文面です。
 *   公開前に、お店に次の3点を確認してください。hint は画面には出ません。
 *     1. 運営統括責任者の氏名
 *     2. 問い合わせ用のメールアドレス
 *     3. キャンセル・返金の扱いが、実際の運用と合っているか
 *   value を空文字にした項目は「準備中」と表示されます。
 */

interface Entry {
  label: string;
  value: string;
  /** 補足・記入時の注意。公開ページには出ません。 */
  hint?: string;
}

const ENTRIES: Entry[] = [
  {
    label: "販売事業者名",
    value: "一般社団法人グッド・コモンズ\nCommons kitchen となりのと",
    hint: "法人番号 4012405004711。登記上の名称と屋号を併記しています",
  },
  {
    label: "運営統括責任者",
    value: "吉葉 真暁",
    hint: "★要確認：法人登記の代表理事名から入れています。実際の責任者が別の方ならそちらに",
  },
  {
    label: "所在地",
    value:
      "東京都調布市佐須町4丁目24番地30（法人所在地）\n東京都調布市国領町4-33-2 オーベルグランディオ調布国領 1F（店舗・商品受取場所）",
    hint: "★郵便番号を追記してください。確認できなかったため入れていません",
  },
  {
    label: "電話番号",
    value:
      "070-6669-1010\n受付時間：火〜金 11:00〜18:00 / 土 11:00〜19:00（日・月は定休）",
    hint: "イベント期間中の受付時間が異なる場合は書き換えてください",
  },
  {
    label: "メールアドレス",
    value: "（公開前にご記入ください）",
    hint: "★要記入：ご予約の確認メールの送信元と同じアドレスで構いません",
  },
  {
    label: "販売価格",
    value:
      "各商品ページに表示された金額（消費税込み）\nご注文時の合計金額は、ご予約内容の確認画面に表示されます。",
  },
  {
    label: "商品代金以外の必要料金",
    value:
      "ありません。\n店頭でのお受け取りのみのため、送料・手数料はいただきません。",
  },
  {
    label: "お支払い方法",
    value:
      "クレジットカード決済（Square）\nVisa / Mastercard / American Express / JCB / Diners Club / Discover\nApple Pay・Google Pay もご利用いただけます。",
  },
  {
    label: "お支払い時期",
    value:
      "ご予約手続きの完了時にお支払いが確定します。\n実際の引き落とし日は、ご利用のカード会社の締め日によります。",
  },
  {
    label: "商品の引渡時期",
    value:
      "ご予約時に指定いただいた受取日に、店頭にてお渡しします。受取時間は各商品ページおよび予約完了メールに記載しています。\n受取日当日にご来店のうえ、予約完了画面またはメールに記載の注文番号をスタッフにお伝えください。",
  },
  {
    label: "返品・交換について",
    value:
      "商品の性質上（食品・受注生産のため）、お客様のご都合による返品・交換はお受けできません。\n\n商品に不良があった場合、または異なる商品をお渡しした場合は、受取日当日中に上記の電話番号までご連絡ください。商品の交換または全額の返金にて対応いたします。",
    hint: "不良品の申し出期限（当日中／翌日まで等）は、お店の運用に合わせて調整してください",
  },
  {
    label: "キャンセルについて",
    value:
      "すべて受注生産のため、ご予約の変更・キャンセルは受取日の前日23:59まで、お電話でのみ承ります。\nそれ以降のキャンセル、および受取日当日にお越しいただけなかった場合は、商品代金の返金はいたしかねます。\n\nキャンセルが成立した場合は、お支払いいただいたクレジットカードへ返金します。カード会社の処理により、ご返金の反映までに数日〜1か月程度かかることがあります。",
    hint: "★要確認：当日キャンセルを一切不可とするか、一部返金するかはお店の判断です",
  },
];

export const metadata = {
  title: "特定商取引法に基づく表記",
};

export default function TokushohoPage() {
  return (
    <main className="min-h-screen bg-paper">
      <div className="bg-white border-b border-zinc-200">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link
            href="/"
            className="text-zinc-400 hover:text-zinc-600 transition-colors"
            aria-label="トップへ戻る"
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
          <h1 className="text-lg font-bold text-zinc-800">
            特定商取引法に基づく表記
          </h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        <dl className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
          {ENTRIES.map((entry, i) => (
            <div
              key={entry.label}
              className={`grid grid-cols-1 sm:grid-cols-[13rem_1fr] ${
                i > 0 ? "border-t border-zinc-100" : ""
              }`}
            >
              <dt className="bg-paper/70 px-5 py-4 text-sm font-bold text-zinc-700">
                {entry.label}
              </dt>
              <dd className="px-5 py-4 text-sm leading-relaxed text-zinc-700 whitespace-pre-line">
                {entry.value || (
                  <span className="text-zinc-400">準備中</span>
                )}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-8 pb-10">
          <Link
            href="/"
            className="block w-full rounded-2xl border border-zinc-200 bg-white py-3.5 text-center text-sm font-semibold text-zinc-700 transition-colors hover:bg-paper"
          >
            トップに戻る
          </Link>
        </div>
      </div>
    </main>
  );
}
