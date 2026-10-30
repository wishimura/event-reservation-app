import { POST as handleIncident } from "../incident/route";

/**
 * 旧い入口。中身は `/api/incident` と同じものです。
 *
 * 記録の対象を決済以外にも広げたときに名前を変えましたが、**お客様が開いたまま
 * にしている画面は古い入口に送ってきます**。消すとその申告が落ちるだけなので、
 * 受け口は残します。
 *
 * `dynamic` は再エクスポートできない（Next が静的に読む設定のため）ので、
 * ここで改めて宣言します。
 */
export const dynamic = "force-dynamic";

export const POST = handleIncident;
