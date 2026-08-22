import { Resend } from "resend";
import { formatDate, formatPrice } from "./utils";

/**
 * Confirmation mail for a reservation.
 *
 * Sending is always best-effort: a failure here is logged but must never turn
 * a reservation that is already committed to the database into an error for
 * the customer. Callers run these through `after()` so the response is not
 * held up by the provider.
 */

const resendApiKey = process.env.RESEND_API_KEY;
const mailFrom = process.env.MAIL_FROM;
const shopNotificationEmail = process.env.SHOP_NOTIFICATION_EMAIL?.trim() || undefined;

const resend = resendApiKey ? new Resend(resendApiKey) : null;

export interface OrderMailPayload {
  order_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  total_amount: number;
  pickup_date: string;
  event_name: string;
  pickup_location: string;
  reservation_note: string;
  contact_phone: string;
  items: Array<{
    product_name_snapshot: string;
    unit_price: number;
    quantity: number;
    subtotal: number;
  }>;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function itemRows(items: OrderMailPayload["items"]): string {
  return items
    .map(
      (i) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;color:#292524;">
          ${escapeHtml(i.product_name_snapshot)}
          <span style="color:#a8a29e;font-size:13px;"> × ${i.quantity}</span>
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;color:#292524;white-space:nowrap;">
          ${formatPrice(i.subtotal)}
        </td>
      </tr>`
    )
    .join("");
}

function itemLines(items: OrderMailPayload["items"]): string {
  return items
    .map(
      (i) =>
        `・${i.product_name_snapshot} × ${i.quantity}　${formatPrice(i.subtotal)}`
    )
    .join("\n");
}

function layout(heading: string, intro: string, body: string): string {
  return `<!doctype html>
<html lang="ja">
<body style="margin:0;padding:24px 12px;background:#fafaf9;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Noto Sans JP',sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e5e4;border-radius:16px;">
    <tr>
      <td style="padding:24px 24px 8px;">
        <h1 style="margin:0 0 8px;font-size:18px;color:#292524;">${escapeHtml(heading)}</h1>
        <p style="margin:0;font-size:14px;line-height:1.7;color:#57534e;">${intro}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 24px 24px;">${body}</td>
    </tr>
  </table>
</body>
</html>`;
}

function detailBlock(payload: OrderMailPayload): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:14px;">
      <tr>
        <td style="padding:12px 0 4px;color:#a8a29e;font-size:12px;">注文番号</td>
      </tr>
      <tr>
        <td style="padding-bottom:12px;color:#292524;font-weight:bold;font-size:16px;">
          ${escapeHtml(payload.order_number)}
        </td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:#a8a29e;font-size:12px;">受取日</td>
      </tr>
      <tr>
        <td style="padding-bottom:12px;color:#292524;font-weight:bold;">
          ${escapeHtml(formatDate(payload.pickup_date))}
        </td>
      </tr>
      ${
        payload.pickup_location
          ? `<tr><td style="padding:4px 0;color:#a8a29e;font-size:12px;">受取場所</td></tr>
             <tr><td style="padding-bottom:12px;color:#292524;">${escapeHtml(payload.pickup_location)}</td></tr>`
          : ""
      }
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:14px;margin-top:8px;">
      <tr>
        <td colspan="2" style="padding:4px 0 8px;color:#a8a29e;font-size:12px;">ご注文内容</td>
      </tr>
      ${itemRows(payload.items)}
      <tr>
        <td style="padding:12px 0;font-weight:bold;color:#57534e;">合計</td>
        <td style="padding:12px 0;text-align:right;font-weight:bold;font-size:18px;color:#92400e;">
          ${formatPrice(payload.total_amount)}
        </td>
      </tr>
    </table>`;
}

function textDetail(payload: OrderMailPayload): string {
  return [
    `注文番号: ${payload.order_number}`,
    `受取日: ${formatDate(payload.pickup_date)}`,
    payload.pickup_location ? `受取場所: ${payload.pickup_location}` : null,
    "",
    "ご注文内容",
    itemLines(payload.items),
    `合計: ${formatPrice(payload.total_amount)}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export function buildCustomerEmail(payload: OrderMailPayload) {
  const body =
    detailBlock(payload) +
    `
    <div style="margin-top:16px;padding:12px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;font-size:13px;color:#78350f;line-height:1.7;">
      お支払いは<strong>受取時に店頭</strong>でお願いいたします。
    </div>` +
    (payload.contact_phone
      ? `<div style="margin-top:12px;padding:12px 14px;border:1px solid #e7e5e4;border-radius:10px;font-size:13px;color:#57534e;line-height:1.7;">
           ご予約の変更・キャンセルはお電話でお願いいたします。<br>
           <a href="tel:${escapeHtml(payload.contact_phone.replace(/[^0-9+]/g, ""))}" style="color:#b45309;font-weight:bold;font-size:15px;text-decoration:none;">${escapeHtml(payload.contact_phone)}</a>
         </div>`
      : "") +
    (payload.reservation_note
      ? `<div style="margin-top:12px;font-size:13px;color:#57534e;line-height:1.7;white-space:pre-line;">${escapeHtml(
          payload.reservation_note
        )}</div>`
      : "");

  return {
    subject: `【ご予約確認】${payload.event_name}（${formatDate(payload.pickup_date)}お受け取り）`,
    html: layout(
      "ご予約ありがとうございます",
      `${escapeHtml(payload.customer_name)} 様<br>下記の内容でご予約を承りました。`,
      body
    ),
    text: [
      `${payload.customer_name} 様`,
      "",
      "ご予約ありがとうございます。下記の内容で承りました。",
      "",
      textDetail(payload),
      "",
      "お支払いは受取時に店頭でお願いいたします。",
      payload.contact_phone
        ? `\nご予約の変更・キャンセルはお電話でお願いいたします。\n${payload.contact_phone}`
        : null,
      payload.reservation_note ? `\n${payload.reservation_note}` : null,
    ]
      .filter((line) => line !== null)
      .join("\n"),
  };
}

export function buildShopEmail(payload: OrderMailPayload) {
  const body =
    detailBlock(payload) +
    `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:14px;margin-top:8px;">
      <tr><td colspan="2" style="padding:12px 0 8px;color:#a8a29e;font-size:12px;">お客様情報</td></tr>
      <tr><td style="padding:2px 0;color:#292524;">${escapeHtml(payload.customer_name)} 様</td></tr>
      <tr><td style="padding:2px 0;color:#57534e;">${escapeHtml(payload.customer_email)}</td></tr>
      <tr><td style="padding:2px 0;color:#57534e;">${escapeHtml(payload.customer_phone)}</td></tr>
    </table>`;

  return {
    subject: `【新規予約】${formatDate(payload.pickup_date)} ${payload.customer_name} 様（${payload.order_number}）`,
    html: layout("新しい予約が入りました", "内容は下記のとおりです。", body),
    text: [
      "新しい予約が入りました。",
      "",
      textDetail(payload),
      "",
      "お客様情報",
      `${payload.customer_name} 様`,
      payload.customer_email,
      payload.customer_phone,
    ].join("\n"),
  };
}

/**
 * Sends the customer confirmation and the shop notification.
 * Resolves even when sending fails — check the logs, not the return value.
 */
export async function sendOrderEmails(payload: OrderMailPayload): Promise<void> {
  if (!resend || !mailFrom) {
    console.warn(
      "Order email skipped: RESEND_API_KEY or MAIL_FROM is not configured."
    );
    return;
  }

  const messages = [
    { to: payload.customer_email, ...buildCustomerEmail(payload) },
    ...(shopNotificationEmail
      ? [{ to: shopNotificationEmail, ...buildShopEmail(payload) }]
      : []),
  ];

  const results = await Promise.allSettled(
    messages.map((m) =>
      resend.emails.send({
        from: mailFrom,
        to: m.to,
        subject: m.subject,
        html: m.html,
        text: m.text,
      })
    )
  );

  results.forEach((result, i) => {
    const to = messages[i].to;
    if (result.status === "rejected") {
      console.error(`Order email to ${to} failed:`, result.reason);
    } else if (result.value.error) {
      console.error(`Order email to ${to} rejected:`, result.value.error);
    }
  });
}
