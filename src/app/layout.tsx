import type { Metadata } from "next";
import "./globals.css";
import { IncidentReporter } from "@/components/IncidentReporter";

export const metadata: Metadata = {
  title: "ご予約 | となりのと commons kitchen",
  description:
    "となりのと commons kitchen の期間限定メニューを、受取日を選んで事前にご予約いただけます。",
  icons: { icon: "/logo-mark.png" },
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
