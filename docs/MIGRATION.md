# MIGRATION

## Policy

- Production DBマイグレーションは自動化しない
- Previewで自動化する場合でも「環境 + フラグ」の二重ゲートが必須

## Current status

- v1 schema は Neon SQL Editor で適用済み（手動）
- 再現性のため、投入SQLのスナップショットを db/schema/v1.sql に保存する

## Notes (must)

- Vercel の buildCommand に migration を含めない
- migration/admin 用に DATABASE_URL_UNPOOLED を使う想定（runtimeとは分離）
- v3（仮登録商品・出典・確認履歴）は db/schema/v3_product_review.sql を手動実行する。アプリは追加列を参照するため、デプロイ前に対象環境へ適用し `pnpm db:verify` で確認する

## 既存の新規商品候補を仮登録へ移行する（データ移行・手動）

解析済みで商品マスタに無い「新規商品候補」の明細を、仮登録（`PROVISIONAL`）の商品として登録する。
対象は `docs/PROVISIONAL_PRODUCT_IMPLEMENTATION_PLAN.md` §9 の取込グループ（納品書1.pdf / 納品書2.pdf）。

前提:

- 対象環境に v3 SQL が適用済みで、状態表示・更新制御・確認操作を含む版がデプロイ済みであること
- 接続先は `DATABASE_URL_UNPOOLED`。実行時に接続先のホスト名とDB名を表示するので、必ず確認する
- ビルドやデプロイからは実行されない。人が手動で実行する

手順:

1. ドライラン（同じ処理を実行して必ずロールバックする。DBは変わらない）
   - `pnpm db:migrate-provisional`
   - 環境変数をファイルから読む場合: `pnpm exec tsx --env-file=.env.local scripts/db/migrate-provisional-products.ts`
2. 出力の「作成する仮登録商品」「単価の相違」「スキップ」「未照合」を確認する
3. 実行（ドライランで表示された作成件数を指定する。件数が違えばコミットしない）
   - `pnpm db:migrate-provisional --execute --expect-created <件数>`
4. もう一度ドライランを実行し、対象が 0 明細・作成 0 商品になることを確認する
5. 仕切り表で対象商品（例: WTP150）を検索し、仮登録ラベルと出典PDFのリンクを確認する

動作:

- 削除されていない書類の「成功した最新の解析」だけを対象にする
- 判定は解析時の仮登録と同じルール。同じ商品キーの明細は1商品に集約し、別口径は別商品のまま
- 既に商品へ紐付いた明細と、その単価履歴は変更しない
- 未照合の明細は商品化せず、件数と内容を表示するだけ
- 既存・確認済み・統合済みの商品にキーが一致した明細は自動反映せず、スキップとして表示する
- 登録済みの単価と異なる単価は上書きせず、差分に「自動停止」として残す
- 再実行しても商品・単価・出典・履歴は増えない
- 別の取込グループを対象にする場合は `--group <upload_group_id>`（複数指定可）
