import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { savedCards } from "@/db/schema";

/**
 * 「2回目からはカードを入れ直さなくていい」を、安全な形で。
 *
 * ## 鍵は端末にある
 *
 * この予約サイトにログインはありません。保存したカードをメールアドレスで
 * 引けるようにすると、**他人のメールアドレスを打った人にその人のカードが
 * 出て、そのまま決済できてしまいます**。鍵にしてよいのは本人しか持ちえない
 * ものだけで、ここではブラウザに置いた長い乱数がそれにあたります。
 *
 * 乱数そのものは Cookie にしか無く、データベースにはその SHA-256 しか
 * 残しません。データベースだけを覗けた人が、そこから Cookie を組み立てて
 * 成りすますことができないように。
 *
 * ## 持たないもの
 *
 * カード番号も有効期限も通りません。預かっているのは Square です。
 */

export const DEVICE_COOKIE = "tt_device";

/** 半年。これより古い端末は、どのみち入力し直してもらうことになる。 */
export const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

/** 推測されない長さ。短くする理由がない。 */
export function newDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** お客様に見せてよい形。id の類は入れない。 */
export interface SavedCardView {
  brand: string;
  last4: string;
  exp_month: number | null;
  exp_year: number | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  /**
   * Square のカード id。
   *
   * ブラウザに渡すのは、本人認証（`verifyBuyer`）にこれが要るためだけです。
   * これだけでは決済できません——決済にはお店の秘密鍵が要り、こちらは
   * **本文に書かれた id を一切信用せず**、必ず Cookie から引き直します。
   */
  square_card_id: string;
}

export interface SavedCardRow extends SavedCardView {
  id: string;
  square_customer_id: string;
}

/**
 * この端末が覚えているカードを引く。
 *
 * 引けなければ null。記録に失敗しても決済を止めないのと同じで、ここで
 * 転んでも「保存が無い」として扱います。入力に戻るだけで済むからです。
 */
export async function findSavedCard(
  deviceToken: string | undefined
): Promise<SavedCardRow | null> {
  if (!deviceToken) return null;

  try {
    const [row] = await db
      .select()
      .from(savedCards)
      .where(eq(savedCards.device_token_hash, hashDeviceToken(deviceToken)))
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      square_customer_id: row.square_customer_id,
      square_card_id: row.square_card_id,
      brand: row.card_brand,
      last4: row.last4,
      exp_month: row.exp_month,
      exp_year: row.exp_year,
      customer_name: row.customer_name,
      customer_email: row.customer_email,
      customer_phone: row.customer_phone,
    };
  } catch (error) {
    console.error("Failed to look up a saved card:", error);
    return null;
  }
}

/** 画面に出してよいところだけ。 */
export function toSavedCardView(row: SavedCardRow): SavedCardView {
  return {
    brand: row.brand,
    last4: row.last4,
    exp_month: row.exp_month,
    exp_year: row.exp_year,
    customer_name: row.customer_name,
    customer_email: row.customer_email,
    customer_phone: row.customer_phone,
    square_card_id: row.square_card_id,
  };
}

/** この端末の記録を消す。Square 側を止めるのは呼ぶ側の仕事。 */
export async function forgetSavedCard(deviceToken: string): Promise<void> {
  await db
    .delete(savedCards)
    .where(eq(savedCards.device_token_hash, hashDeviceToken(deviceToken)));
}

/**
 * 決済が済んだカードを、次回のために覚える。
 *
 * ## 元にするもの
 *
 * Square のカード保存は、入力欄のトークンだけでなく**決済 id** も受け付けます
 * （`sourceId`: "This can be a card nonce or a payment id"）。こちらを使います。
 *
 * 最初は、決済のあとにもう一度 `tokenize()` してその結果を送っていました。
 * 本番で保存されず、2回目にカードが出てこないという形で出ました。決済 id なら
 * 画面にもう一度触る必要がなく、本人認証（3Dセキュア）も済んだあとの id なので、
 * 保存のために改めて認証を求められることもありません。
 *
 * ## 投げないこと
 *
 * 呼ばれるのは支払いが終わったあとです。ここで転んでも、お客様は何も失って
 * いません——次回また入力していただくだけです。理由は記録に残します。
 */
export async function rememberCardFromPayment(params: {
  deviceToken: string;
  squarePaymentId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}): Promise<void> {
  const { recordIncident } = await import("@/lib/incident-log");
  const { disableStoredCard, storeCardForNextTime } = await import("@/lib/square");

  const hash = hashDeviceToken(params.deviceToken);
  const previous = await findSavedCard(params.deviceToken);

  let stored;
  try {
    stored = await storeCardForNextTime({
      sourceId: params.squarePaymentId,
      idempotencyKey: `${hash.slice(0, 12)}-${params.squarePaymentId.slice(0, 20)}`,
      customerName: params.customerName,
      customerEmail: params.customerEmail,
      customerPhone: params.customerPhone,
    });
  } catch (error) {
    await recordIncident({
      area: "payment",
      source: "server",
      stage: "store_card",
      outcome: "error",
      customer_email: params.customerEmail,
      message: "次回のためのカード保存に失敗しました",
      detail: {
        reason: error instanceof Error ? error.message : String(error),
        square_payment_id: params.squarePaymentId,
      },
    });
    return;
  }

  try {
    // 1端末に1枚。入れ替えるときは、前のカードを Square 側でも止める。
    if (previous) {
      await db.delete(savedCards).where(eq(savedCards.id, previous.id));
      await disableStoredCard(previous.square_card_id);
    }

    await db.insert(savedCards).values({
      device_token_hash: hash,
      square_customer_id: stored.customerId,
      square_card_id: stored.cardId,
      card_brand: stored.brand,
      last4: stored.last4,
      exp_month: stored.expMonth,
      exp_year: stored.expYear,
      customer_name: params.customerName,
      customer_email: params.customerEmail,
      customer_phone: params.customerPhone,
    });
  } catch (error) {
    await recordIncident({
      area: "payment",
      source: "server",
      stage: "store_card",
      outcome: "error",
      customer_email: params.customerEmail,
      message: "保存したカードを書き留められませんでした",
      detail: { reason: error instanceof Error ? error.message : String(error) },
    });
    // こちらが持たないカードを Square に残さない。
    await disableStoredCard(stored.cardId);
    return;
  }

  /*
    うまくいったことは、どこにも書きません。

    以前はここで「次回のためにカードを覚えました（VISA ****1234）」と
    残していました。やめた理由は2つです。

    1つめ。**下4桁が管理画面に出ていると、お店が不安になります。**
    「うちがカード情報を持っているのでは」と問い合わせが来ました。実際は
    持っていないのですが、見えるものが誤解を生むなら、見せない方がよい。
    下4桁そのものは明細にもレシートにも出る値で、これだけで決済はできま
    せんが、安心はそういう理屈では動きません。

    2つめ。**お店にできることが何もありません。** 調査ログは「画面を見て
    いるだけでは分からない失敗」を調べるための場所です。お客様がカードを
    覚えさせたことは失敗ではなく、お店が触る話でもありません。誰が
    カードを預けているかの一覧を、お店に見せる理由がない。

    うまくいかなかったときは、下に残っているとおり記録します。そちらは
    「保存できていない」という事実で、理由も要ります。
  */
}

/** Cookie に載せるときの決まり。保存する側と消す側で食い違わないように。 */
export const DEVICE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: DEVICE_COOKIE_MAX_AGE,
} as const;
