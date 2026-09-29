import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ご予約 | となりのと commons kitchen",
  description:
    "となりのと commons kitchen の期間限定メニューを、受取日と時間を選んで事前にご予約いただけます。",
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
        {children}
      </body>
    </html>
  );
}
