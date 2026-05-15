export const appNavigationItems = [
  {
    href: "/",
    title: "ホーム",
    description: "確認待ちの紐づけと各機能への入口を確認します。",
  },
  {
    href: "/documents",
    title: "納品書アップロード",
    description: "PDF納品書のアップロード、一覧確認、解析実行へ進みます。",
  },
  {
    href: "/products",
    title: "商品マスタ",
    description: "PDF解析や仕切り表から作成された商品情報を確認します。",
  },
  {
    href: "/records",
    title: "レコード検索",
    description: "商品・仕入先・単価の履歴を横断検索します。",
  },
  {
    href: "/documents",
    title: "差分確認",
    description: "納品書ごとの解析結果と商品マスタ更新候補を確認します。",
  },
] as const;
