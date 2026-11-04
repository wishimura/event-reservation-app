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
