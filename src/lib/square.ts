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
    response = await getClient().payments.create({
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
      // Omitted entirely when absent — Square rejects an empty string.
      ...(params.verificationToken
        ? { verificationToken: params.verificationToken }
        : {}),
      autocomplete: true,
    });
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
