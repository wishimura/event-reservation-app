"use client";

/**
 * The admin console's confirmations and errors.
 *
 * These used to render inline at the top of the page, which meant that
 * acting on a control further down — on a phone, most of the page is
 * further down — produced a message nobody could see. The operator was left
 * unable to tell a success from a silent failure.
 *
 * Fixed to the viewport instead, so it is in view wherever the button was.
 */
export function Toast({
  message,
}: {
  message: { text: string; ok: boolean } | null;
}) {
  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-4 bottom-4 z-50 rounded-lg px-4 py-3 text-sm shadow-lg md:inset-x-auto md:bottom-auto md:right-6 md:top-6 md:max-w-sm ${
        message.ok
          ? "bg-emerald-600 text-white"
          : "bg-red-600 text-white"
      }`}
    >
      {message.text}
    </div>
  );
}
