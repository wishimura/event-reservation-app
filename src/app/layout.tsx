import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "カフェ期間限定イベント予約",
  description: "期間限定イベントの事前予約アプリ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="bg-stone-50 text-stone-900 antialiased">
        {children}
      </body>
    </html>
  );
}
