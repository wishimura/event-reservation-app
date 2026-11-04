import { SquareClient, SquareEnvironment } from "square";

/**
 * Square payments.
 *
 * The app keeps working without any Square configuration: until the shop's
 * credentials are in place, reservations fall back to paying at the counter,
 * exactly as before. Card payment switches on only when all three values are
 * present, so the live site can never end up asking for a card it cannot
 * charge.
 *
 * Refunds are deliberately NOT automated. Cancellations are handled by phone
 * and the refund is issued by hand in the Square dashboard, which is why the
 * payment id and receipt URL are stored on the order.
 */

const accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim();
const applicationId = process.env.SQUARE_APPLICATION_ID?.trim();
const locationId = process.env.SQUARE_LOCATION_ID?.trim();

/** "production" once the shop is live; anything else uses Square's sandbox. */
const environment =
  process.env.SQUARE_ENVIRONMENT?.trim() === "production"
    ? SquareEnvironment.Production
    : SquareEnvironment.Sandbox;

export function isSquareEnabled(): boolean {
  return Boolean(accessToken && applicationId && locationId);
}

/** Registering a domain needs the token alone, not the whole card setup. */
export function hasSquareAccessToken(): boolean {
  return Boolean(accessToken);
}

/** Values the browser needs to render the card form. Neither is a secret. */
export function squarePublicConfig() {
  return {
    enabled: isSquareEnabled(),
    applicationId: applicationId ?? null,
    locationId: locationId ?? null,
  };
}

let client: SquareClient | undefined;

function getClient(): SquareClient {
  if (!accessToken) {
    throw new Error("SQUARE_ACCESS_TOKEN is not set");
  }
  client ??= new SquareClient({ token: accessToken, environment });
  return client;
}

export interface ChargeResult {
  paymentId: string;
  receiptUrl: string | null;
}

export class SquarePaymentError extends Error {
  /** Safe to show the customer. */
  readonly customerMessage: string;

  constructor(customerMessage: string, cause?: unknown) {
    super(customerMessage);
    this.name = "SquarePaymentError";
    this.customerMessage = customerMessage;
    this.cause = cause;
  }
}

/**
 * Charges a tokenised card for the whole order.
 *
 * `idempotencyKey` is the order id, so a retried request can never take the
 * money twice — Square returns the original payment instead of making a new
 * one.
 *
 * `verificationToken` carries the 3-D Secure verification, when the browser
 * produced one. It is passed through untouched; Square decides whether the
 * issuer's challenge was sufficient.
 */
export async function chargeOrder(params: {
  sourceId: string;
  amountYen: number;
  idempotencyKey: string;
  referenceId: string;
  note: string;
  customerEmail?: string;
  /**
   * Required when `sourceId` is a stored card rather than a one-time token.
   * Square refuses a card-on-file charge that does not say whose card it is.
   */
  customerId?: string;
  /**
   * The 3-D Secure result from `payments.verifyBuyer()` in the browser.
   * Cards issued in Japan and the EU increasingly require it, and Square
   * declines the payment outright when the issuer asks for a challenge and
   * no token is supplied.
   */
  verificationToken?: string;
}): Promise<ChargeResult> {
  if (!locationId) {
    throw new SquarePaymentError("決済の設定が完了していません");
  }

  let response;
  try {
    response = await getClient().payments.create(
      {
        sourceId: params.sourceId,
        idempotencyKey: params.idempotencyKey,
        amountMoney: {
          amount: BigInt(params.amountYen),
          currency: "JPY",
        },
        locationId,
        // Square truncates these, so keep them short.
        referenceId: params.referenceId.slice(0, 40),
        note: params.note.slice(0, 500),
        buyerEmailAddress: params.customerEmail,
        ...(params.customerId ? { customerId: params.customerId } : {}),
        // Omitted entirely when absent — Square rejects an empty string.
        ...(params.verificationToken
          ? { verificationToken: params.verificationToken }
          : {}),
        autocomplete: true,
      },
      /**
       * Bounded, because the customer is sitting in front of a spinner and
       * the function itself is on a clock. A charge normally answers in a
       * second or two; anything near this is Square or the issuer being
       * unreachable, and failing then is better than being cut off partway.
       *
       * Retrying is safe — the idempotency key means a repeat of a request
       * that did get through comes back with the original payment rather
       * than making a second one.
       */
      { timeoutInSeconds: 12, maxRetries: 2 }
    );
  } catch (error) {
    console.error("Square payment failed:", error);
    throw new SquarePaymentError(
      "カードの決済に失敗しました。カード情報をご確認のうえ、もう一度お試しください。",
      error
    );
  }

  const payment = response.payment;

  if (!payment?.id) {
    console.error("Square returned no payment:", response.errors);
    throw new SquarePaymentError("決済処理に失敗しました");
  }

  // COMPLETED is the success state for an autocompleted payment; APPROVED
  // means the funds are only held, which we never ask for.
  if (payment.status !== "COMPLETED") {
    console.error("Square payment not completed:", payment.status);
    throw new SquarePaymentError(
      "カードの決済が完了しませんでした。別のカードをお試しください。"
    );
  }

  return {
    paymentId: payment.id,
    receiptUrl: payment.receiptUrl ?? null,
  };
}

export type ApplePayRegistration =
  | { status: "verified" }
  | { status: "pending" };

/**
 * Registers a domain for Apple Pay.
 *
 * Apple will not show its button on a domain it has not verified, and it
 * verifies by fetching `/.well-known/apple-developer-merchantid-domain-
 * association` — which this app serves — over public HTTPS. Square asks Apple
 * on the shop's behalf, so no Apple Developer account is involved.
 *
 * "pending" means Apple could not read the file. That is almost always the
 * domain being unreachable rather than anything about the account.
 *
 * Registering a domain that is already registered is harmless.
 */
export async function registerApplePayDomain(
  domainName: string
): Promise<ApplePayRegistration> {
  if (!accessToken) {
    throw new SquarePaymentError("Square の認証情報が設定されていません");
  }

  const response = await getClient().applePay.registerDomain({ domainName });

  return response.status === "VERIFIED"
    ? { status: "verified" }
    : { status: "pending" };
}

/* ------------------------------------------------------------------ *
 *  Cards kept for next time
 * ------------------------------------------------------------------ */

export interface StoredCard {
  customerId: string;
  cardId: string;
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
}

/**
 * Hands a card to Square to keep, and comes back with the handle for it.
 *
 * **The card number never reaches us.** What goes up is the single-use token
 * the browser got from Square's own form; what comes back is an id that only
 * works alongside this shop's secret key. The four digits and the brand are
 * for showing the customer which card they are about to use.
 *
 * Throws on failure, and the caller is expected to carry on regardless: this
 * runs *after* the reservation is paid for, so nothing a customer is waiting
 * on depends on it working.
 */
export async function storeCardForNextTime(params: {
  /** A fresh token from `card.tokenize()` — not the one the charge used. */
  sourceId: string;
  idempotencyKey: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  /**
   * From `verifyBuyer(token, { intent: "STORE" })`. Square asks for it where
   * the buyer's bank requires strong authentication to keep a card on file.
   */
  verificationToken?: string;
}): Promise<StoredCard> {
  const client = getClient();

  /*
    A customer profile per saved card, rather than one looked up by email.

    Searching by email and reusing the match would tie together people who
    share an address, and would make the lookup itself a way of asking
    "does this address have a card with you?". Each device that saves a
    card gets its own profile; duplicates in the Square dashboard are a
    smaller problem than either of those.
  */
  const { given, family } = splitJapaneseName(params.customerName);

  /*
    連絡先は、付けられたら付ける程度のもの。

    本番で `INVALID_PHONE_NUMBER` が返り、カードが保存されませんでした
    （Square は国番号付きの形を求めます）。番号は整えて渡しますが、整えても
    弾かれることはあります。そのときに**カードごと預けられなくなる**のは
    割に合いません——連絡先はこちらの表にも持っていて、Square 側のそれは
    ダッシュボードで見やすいというだけのものです。

    なので、弾かれたらお名前だけで作り直します。
  */
  const contact = {
    emailAddress: looksLikeEmail(params.customerEmail)
      ? params.customerEmail
      : undefined,
    phoneNumber: toE164Japan(params.customerPhone),
  };

  const createCustomer = (extra: Record<string, string | undefined>) =>
    client.customers.create({
      idempotencyKey: `cust-${params.idempotencyKey}`,
      givenName: given || undefined,
      familyName: family || undefined,
      ...extra,
    });

  let customerResponse;
  try {
    customerResponse = await createCustomer(contact);
  } catch (error) {
    console.error(
      "Square rejected the customer's contact details; retrying with the name alone:",
      error
    );
    customerResponse = await createCustomer({});
  }

  const customerId = customerResponse.customer?.id;
  if (!customerId) {
    throw new Error("Square returned no customer id");
  }

  const cardResponse = await client.cards.create({
    idempotencyKey: `card-${params.idempotencyKey}`,
    sourceId: params.sourceId,
    ...(params.verificationToken
      ? { verificationToken: params.verificationToken }
      : {}),
    card: {
      customerId,
      cardholderName: params.customerName || undefined,
    },
  });

  const card = cardResponse.card;
  if (!card?.id) {
    throw new Error("Square returned no card id");
  }

  return {
    customerId,
    cardId: card.id,
    brand: card.cardBrand ?? "",
    last4: card.last4 ?? "",
    expMonth: card.expMonth == null ? null : Number(card.expMonth),
    expYear: card.expYear == null ? null : Number(card.expYear),
  };
}

/**
 * Tells Square to stop honouring a stored card.
 *
 * Called when the customer asks us to forget it, and when a saved card is
 * replaced. Never throws: the row on our side is going away either way, and
 * a card nobody can name is already unreachable.
 */
export async function disableStoredCard(cardId: string): Promise<void> {
  try {
    await getClient().cards.disable({ cardId });
  } catch (error) {
    console.error("Failed to disable a stored card:", cardId, error);
  }
}

/**
 * 日本の電話番号を、Square の求める形にする。
 *
 * Square は国番号から始まる形（E.164）を求めます。「090-1234-5678」のまま
 * 渡すと `INVALID_PHONE_NUMBER` で弾かれ、カードが保存されません。
 *
 * 国内の番号は先頭の 0 を落として +81 を付けます。既に + で始まっていれば
 * そのまま。どちらにも当てはまらなければ渡しません——間違った番号を送って
 * 保存ごと失敗するより、番号が無いほうがましです。
 */
export function toE164Japan(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : undefined;
  }

  const digits = trimmed.replace(/\D/g, "");
  // 国内の番号は 0 で始まり、市外局番を含めて 10桁か 11桁。
  if (!/^0\d{9,10}$/.test(digits)) return undefined;
  return `+81${digits.slice(1)}`;
}

/** 形だけ見る。確かめるのは送ってみた先の話。 */
function looksLikeEmail(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.length > 0 && trimmed.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/**
 * Splits a Japanese name the way Square's two fields expect.
 *
 * Mirrors `splitName` on the confirm page. Names typed without a space stay
 * whole in the family-name field, which is the convention the shop's own
 * paperwork follows.
 */
function splitJapaneseName(full: string): { given: string; family: string } {
  const parts = full.trim().split(/[\s　]+/).filter(Boolean);
  if (parts.length === 0) return { given: "", family: "" };
  if (parts.length === 1) return { given: "", family: parts[0] };
  return { family: parts[0], given: parts.slice(1).join(" ") };
}
