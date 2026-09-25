import Link from "next/link";

/**
 * Legal links. The 特定商取引法 page has to be reachable before a customer
 * pays, so this sits on the top page and on the confirmation screen rather
 * than only in some out-of-the-way corner.
 */
export function SiteFooter() {
  return (
    <footer className="mt-10 border-t border-stone-200 pt-5 pb-10">
      <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        <Link
          href="/legal/tokushoho"
          className="text-xs text-stone-500 underline underline-offset-4 transition-colors hover:text-stone-700"
        >
          特定商取引法に基づく表記
        </Link>
      </nav>
    </footer>
  );
}
