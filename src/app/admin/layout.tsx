import type { Metadata } from "next";
import { NOINDEX } from "@/lib/indexing";

/**
 * 管理画面は、公開後も検索エンジンに載せません。
 *
 * 入口の `robots.txt` でも外していますが、こちらが本命です。robots.txt は
 * 「読みに来ないでほしい」という申し入れに過ぎず、読みに来ない相手には
 * ページの中身も伝わりません。こちらは読んだ相手に直接「載せないで」と
 * 伝えます。
 *
 * お客様向けの画面は公開時に載るようになりますが（`src/lib/indexing.ts`）、
 * ここはそれとは関係なく、ずっと載りません。
 */
export const metadata: Metadata = { robots: NOINDEX };

export default function AdminSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
