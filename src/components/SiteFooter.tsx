import Image from "next/image";
import Link from "next/link";

/**
 * The shop's mark, and the legal links.
 *
 * The 特定商取引法 page has to be reachable before a customer pays, so this
 * sits on the top page and on the confirmation screen rather than only in
 * some out-of-the-way corner.
 */
export function SiteFooter() {
  return (
    <footer className="mt-10 border-t border-zinc-200 pt-6 pb-10">
      <div className="flex flex-col items-center gap-4">
        <Image
          src="/logo.png"
          alt="となりのと commons kitchen"
          width={931}
          height={977}
          className="h-14 w-auto opacity-80"
        />
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <Link
            href="/legal/tokushoho"
            className="text-xs text-zinc-500 underline underline-offset-4 transition-colors hover:text-brand-600"
          >
            特定商取引法に基づく表記
          </Link>
        </nav>
      </div>
    </footer>
  );
}
