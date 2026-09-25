import Link from "next/link";

/**
 * 特定商取引法に基づく表記
 *
 * Required once the site takes payment online. Content is edited here rather
 * than in the database: it changes rarely, and it has to be reviewable in the
 * repository alongside the code that takes the money.
 *
 * ★ 中身は未記入です。下の ENTRIES の value を埋めてください。
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
    value: "",
    hint: "屋号ではなく、登記上の名称または個人事業主の氏名",
  },
  {
    label: "運営統括責任者",
    value: "",
  },
  {
    label: "所在地",
    value: "",
    hint: "郵便番号から。請求があった場合に遅滞なく開示する旨の記載で代替する運用もあります",
  },
  {
    label: "電話番号",
    value: "",
    hint: "受付時間も併記すると親切です",
  },
  {
    label: "メールアドレス",
    value: "",
  },
  {
    label: "販売価格",
    value: "各商品ページに表示された金額（消費税込み）",
  },
  {
    label: "商品代金以外の必要料金",
    value: "",
    hint: "店頭受取のみであれば「なし」。振込手数料等があれば記載",
  },
  {
    label: "お支払い方法",
    value: "クレジットカード決済（Square）",
  },
  {
    label: "お支払い時期",
    value: "ご予約手続きの完了時にお支払いが確定します。",
  },
  {
    label: "商品の引渡時期",
    value:
      "ご予約時に指定いただいた受取日に、店頭にてお渡しします。受取時間は各商品ページおよび予約完了メールに記載しています。",
  },
  {
    label: "返品・交換について",
    value: "",
    hint: "食品のため、商品の性質上いかなる場合に返品を受けるか／受けないかを明記",
  },
  {
    label: "キャンセルについて",
    value: "",
    hint: "受注生産のため、いつまで受け付けるか（例：受取日の前日◯時まで）と、返金の方法・時期を明記",
  },
];

export const metadata = {
  title: "特定商取引法に基づく表記",
};

export default function TokushohoPage() {
  return (
    <main className="min-h-screen bg-stone-50">
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link
            href="/"
            className="text-stone-400 hover:text-stone-600 transition-colors"
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
          <h1 className="text-lg font-bold text-stone-800">
            特定商取引法に基づく表記
          </h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        <dl className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
          {ENTRIES.map((entry, i) => (
            <div
              key={entry.label}
              className={`grid grid-cols-1 sm:grid-cols-[13rem_1fr] ${
                i > 0 ? "border-t border-stone-100" : ""
              }`}
            >
              <dt className="bg-stone-50/70 px-5 py-4 text-sm font-bold text-stone-700">
                {entry.label}
              </dt>
              <dd className="px-5 py-4 text-sm leading-relaxed text-stone-700 whitespace-pre-line">
                {entry.value || (
                  <span className="text-stone-400">準備中</span>
                )}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-8 pb-10">
          <Link
            href="/"
            className="block w-full rounded-2xl border border-stone-200 bg-white py-3.5 text-center text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-50"
          >
            トップに戻る
          </Link>
        </div>
      </div>
    </main>
  );
}
