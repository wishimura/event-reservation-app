/**
 * The icon set.
 *
 * Emoji render differently on every platform — Android, iOS and Windows each
 * draw their own, at their own weight — so the admin console looked like a
 * different product depending on the device. These are plain stroked shapes
 * that inherit the surrounding colour and size, and look the same everywhere.
 *
 * Size comes from the className (`w-5 h-5`), colour from `currentColor`.
 */

export type IconName =
  | "home"
  | "box"
  | "clipboard"
  | "list"
  | "bag"
  | "tag"
  | "gear"
  | "coffee"
  | "calendar"
  | "pin"
  | "note"
  | "cash"
  | "card";

const paths: Record<IconName, React.ReactNode> = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M9.5 20v-5.5h5V20" />
    </>
  ),
  box: (
    <>
      <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z" />
      <path d="m3 7.5 9 4.5 9-4.5" />
      <path d="M12 12v9" />
    </>
  ),
  clipboard: (
    <>
      <path d="M9 4h6v3H9z" />
      <path d="M9 5.5H6.5v15h11v-15H15" />
      <path d="M9 11h6M9 15h4" />
    </>
  ),
  list: (
    <>
      <path d="M4 6.5h2M4 12h2M4 17.5h2" />
      <path d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20" />
    </>
  ),
  bag: (
    <>
      <path d="M5 7.5h14l-1 13H6l-1-13Z" />
      <path d="M9 10V6a3 3 0 0 1 6 0v4" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 11.5V4.5h7l10 10-7 7-10-10Z" />
      <circle cx="7.5" cy="8.5" r="1.25" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" />
    </>
  ),
  coffee: (
    <>
      <path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z" />
      <path d="M17 9.5h1.5a2.5 2.5 0 0 1 0 5H17" />
      <path d="M8 2.5v2.5M12 2.5v2.5" />
    </>
  ),
  calendar: (
    <>
      <path d="M4 6.5h16v14H4z" />
      <path d="M4 10.5h16" />
      <path d="M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s6.5-6.1 6.5-11a6.5 6.5 0 0 0-13 0C5.5 14.9 12 21 12 21Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  note: (
    <>
      <path d="M6 3.5h8L19 8v12.5H6z" />
      <path d="M13.5 3.5V8.5H19" />
      <path d="M9 13h7M9 16.5h5" />
    </>
  ),
  cash: (
    <>
      <path d="M3 6.5h18v11H3z" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6.5 10v4M17.5 10v4" />
    </>
  ),
  card: (
    <>
      <path d="M3 6h18v12H3z" />
      <path d="M3 10h18" />
      <path d="M6.5 14.5h4" />
    </>
  ),
};

export function Icon({
  name,
  className = "w-5 h-5",
  label,
}: {
  name: IconName;
  className?: string;
  /** Give this when the icon stands on its own, with no text beside it. */
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {paths[name]}
    </svg>
  );
}
