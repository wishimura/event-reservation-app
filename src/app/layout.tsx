import type { Metadata } from "next";
import "./globals.css";
import { IncidentReporter } from "@/components/IncidentReporter";
// 掲載の決まりは `src/lib/indexing.ts` に。ここでは何も指示しません。

export const metadata: Metadata = {
  title: "ご予約 | となりのと commons kitchen",
  description:
    "となりのと commons kitchen の期間限定メニューを、受取日を選んで事前にご予約いただけます。",
  icons: { icon: "/logo-mark.png" },
  /*
    検索エンジンへの指示は書きません。書かないことが「載せてよい」です。

    公開前は全ページに noindex を付けていました。公開したので外します。
    管理画面だけは `src/app/admin/layout.tsx` で noindex を上書きしていて、
    こちらの変更とは関係なく、ずっと載りません。
  */
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="bg-paper text-zinc-900 antialiased">
        {/*
          画面で起きた例外を拾って残す。見た目には何も出しません。
          これが無いあいだ、画面が落ちてもこちらには一行も届きませんでした。
        */}
        <IncidentReporter />
        {children}
      </body>
    </html>
  );
}
