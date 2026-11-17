<div align="center">

<img src="web/public/brand/shard-icon.svg" width="88" height="88" alt="Shard logo">

# Shard

**自分のパソコンで動かす、AI 動画と画像のモーションデザインスタジオ。**

映画の企画、シーンの生成、仕上げまでを、Web スタジオ、ターミナル、または Claude Code と Codex から行えます。

[![Validate](https://github.com/AlexMakesC0de/shard-motion-design-studio/actions/workflows/validate.yml/badge.svg)](https://github.com/AlexMakesC0de/shard-motion-design-studio/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node 20+](https://img.shields.io/badge/node-20%2B-5FA04E?logo=node.js&logoColor=white)
![macOS](https://img.shields.io/badge/platform-macOS-555)
![Claude Code | Codex](https://img.shields.io/badge/works%20with-Claude%20Code%20%7C%20Codex-B4471C)

[English](README.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [한국어](README.ko.md) · [Português (Brasil)](README.pt-BR.md) · [Deutsch](README.de.md)

これは翻訳です。英語版と内容が異なる場合は、[README.md](README.md) が優先されます。

[クイックスタート](#クイックスタート) · [クレジット](#クレジット) · [CLI](cli/README.md) · [MCP サーバー](mcp/README.md) · [スタジオ](web/README.md)

</div>

---

Shard は、**[Chase の motion-design スキル](https://github.com/cth9191/motion-design)** のフォークとして始まりました。見栄えのよい 10 種類のモーションスタイルと、その元になったプロンプトが入っています。Chase に心から感謝します。このリポジトリのルック(スタイル)は彼のものです。その周りに作ったものはすべて新しい部分です。詳しくは[クレジット](#クレジット)をご覧ください。

## 中身

| パーツ | できること |
|---|---|
| **スタジオ**(`web/`) | ローカルの Web アプリ。画像ページと動画ページ、シーンごとに企画する映画、キャラクター・商品・場所のライブラリ、ルック、あなたのスキル、利用料金と設定。 |
| **`kie` CLI**(`cli/`) | [kie.ai](https://kie.ai) 経由で動画・画像・音声を生成します(予備として WaveSpeed も使用)。すべてのジョブを先に見積もり、一件ずつ記録を残します。 |
| **MCP サーバー**(`mcp/`) | Claude Code、Codex、Claude Desktop に、スタジオと同じツールを提供します。頼むだけで映画が作れます。 |
| **レンダリングと仕上げ**(`render/`、`cli/`) | Remotion でタイトル・ロゴ・数字などの正確なグラフィックをコードで描き、ffmpeg で仕上げます。音楽、字幕、音量、別のアスペクト比にも対応。 |
| **スキルライブラリ**(`skills/`) | お気に入りのエージェントスキルを集めたもの。それぞれ `/slash-command`、MCP プロンプト、スタジオ内のどれでも使えます。`motion-design` にはルックが入っています。 |

**支出はどこでも守られています。** 有料のジョブはすべて、送信前に見積もられ、1 日の上限と任意のジョブごとの上限に照らして確認されます。スタジオ、CLI、エージェントのどこから実行しても同じです。調べもの、企画、見積もりは無料です。

## クイックスタート

**Node 20+** と **kie.ai の API キー**が必要です。ffmpeg は仕上げのときだけ、Python 3.10+ はルックのギャラリーを作り直すときだけ必要です。

1. **コードを取得してツールをインストールします。** インストーラーは `kie` を PATH に追加し、Claude Code、Codex、Kimi がインストールされていればスキルをリンクし、MCP サーバーを登録します。

   ```bash
   git clone https://github.com/AlexMakesC0de/shard-motion-design-studio.git
   cd shard-motion-design-studio
   node install.mjs            # --dry-run shows what it would change first
   ```

2. **kie.ai のキーを追加します。** 自分だけが読めるようにしてから、設定を確認します。`kie doctor` は無料の残高確認を 1 回行うだけで、何も生成しません。

   ```bash
   mkdir -p ~/.config/kie
   printf '%s' 'YOUR_KIE_KEY' > ~/.config/kie/key && chmod 600 ~/.config/kie/key
   kie doctor
   ```

3. **予算を決めます。** たとえば、1 日あたり最大 25 ドル、1 ジョブあたり 2 ドルまで:

   ```bash
   kie limits --daily 25 --per-job 2
   ```

4. **スタジオを開きます。** http://127.0.0.1:4317 で動き、自分のマシンからのアクセスにだけ応答します。

   ```bash
   npm --prefix web install
   npm run studio
   ```

5. **またはエージェントに頼みます。** Claude Code か Codex を再起動して、こう話しかけてみてください。*「私のアプリの 15 秒の商品映画を企画して、料金を見せて。まだ何も生成しないで。」* スタジオの MCP ページに、各アプリ向けの正確なセットアップコマンドがあります。

## ターミナルから作ってみる

```bash
kie presets                                        # the ten looks
kie preflight --model seedance-2-5 --duration 10   # what a job would cost, without spending
kie video    --run launch --preset kinetic-typography --duration 10
kie render   --run launch --template logo-reveal --props brand.json
kie assemble --run launch --shot out.mp4 --shot logo-reveal.mp4 --transition fade:0.5
kie variants --run launch --video film.mp4 --ratios 9:16,1:1
```

生成された動画は写真のようなものです。それらしいピクセルを作り出します。見出し、ロゴ、価格のように正確でなければならないものは、`kie render` で描いて映像の上に重ねるほうがうまくいきます。どちらをいつ使うかは、[graphic-motion.md](skills/motion-design/references/graphic-motion.md) で説明しています。

作った映画、テイク、支出の記録は `runs/` に、保存した参照素材は `library/` に残ります。どちらも git の管理対象外です。

## ルック

<!-- The gallery below is Chase's material, kept as he made it. -->
<p align="center"><sub>10 種類のルックとこれらのプレビューは、<a href="https://github.com/cth9191/motion-design">Chase の motion-design リポジトリ</a>のものです。画像をクリックすると元の映像が再生されます。</sub></p>

<table>
  <tr>
    <td width="33%" valign="top">
      <a href="https://d2ol7oe51mr4n9.cloudfront.net/user_3DiY2MbHSIvzM3FG2DOgC6Cf2MM/fee13558-1de4-46cb-80c6-443935cb8257.mp4"><img src="docs/images/glass-ui-launch.png" alt="Glass UI launch — Higgsfield source preview" width="432" /></a><br />
      <strong>Glass UI launch</strong><br />
      <sub>Software & product launches</sub>
    </td>
    <td width="33%" valign="top">
      <a href="https://d2ol7oe51mr4n9.cloudfront.net/user_3DiY2MbHSIvzM3FG2DOgC6Cf2MM/a95756c8-1f3f-4d93-9ea9-a14832aba4bd.mp4"><img src="docs/images/tropical-product.png" alt="Tropical product — Higgsfield source preview" width="432" /></a><br />
      <strong>Tropical product</strong><br />
      <sub>Products & ingredients</sub>
    </td>
    <td width="33%" valign="top">
      <a href="https://d2ol7oe51mr4n9.cloudfront.net/user_3DiY2MbHSIvzM3FG2DOgC6Cf2MM/75a6c434-a18a-4484-81b0-387308743279.mp4"><img src="docs/images/kinetic-typography.png" alt="Kinetic typography — Higgsfield source preview" width="432" /></a><br />
      <strong>Kinetic typography</strong><br />
      <sub>Announcements & animated type</sub>
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <a href="https://d2ol7oe51mr4n9.cloudfront.net/user_3DiY2MbHSIvzM3FG2DOgC6Cf2MM/4e68af0a-c12e-4dd2-9f69-3b523e534ee4.mp4"><img src="docs/images/blueprint-to-building.png" alt="Blueprint to building — Higgsfield source preview" width="432" /></a><br />
      <strong>Blueprint to building</strong><br />
      <sub>Architecture & property</sub>
    </td>
    <td width="33%" valign="top">
      <a href="https://d2ol7oe51mr4n9.cloudfront.net/user_3DiY2MbHSIvzM3FG2DOgC6Cf2MM/9eb4a7a5-d79c-459a-8a8d-593e912aa7a3.mp4"><img src="docs/images/exploded-product.png" alt="Exploded product — Higgsfield source preview" width="432" /></a><br />
      <strong>Exploded product</strong><br />
      <sub>Hardware & component reveals</sub>
    </td>
    <td width="33%" valign="top">
      <a href="https://d2ol7oe51mr4n9.cloudfront.net/user_3DiY2MbHSIvzM3FG2DOgC6Cf2MM/eda55630-7def-48c7-b4a8-f73e6022b653.mp4"><img src="docs/images/flat-vector-explainer.png" alt="Flat vector explainer — Higgsfield source preview" width="432" /></a><br />
      <strong>Flat vector explainer</strong><br />
      <sub>Apps & simple explanations</sub>
    </td>
  </tr>
</table>

<details>
<summary><strong>さらに 4 つのスタイルを見る</strong> — ハイパーモーション、2D + 3D ハイブリッド、コラージュ、実写映像</summary>

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="https://d2ol7oe51mr4n9.cloudfront.net/user_3DiY2MbHSIvzM3FG2DOgC6Cf2MM/d1e752b7-ea6b-4553-98c6-15c8f3bf0cb4.mp4"><img src="docs/images/product-hyper-motion.png" alt="Product hyper-motion — Higgsfield source preview" width="432" /></a><br />
      <strong>Product hyper-motion</strong><br />
      <sub>Food & product assembly</sub>
    </td>
    <td width="50%" valign="top">
      <a href="https://d2ol7oe51mr4n9.cloudfront.net/user_3DiY2MbHSIvzM3FG2DOgC6Cf2MM/4d56be98-74fb-4616-9269-db37ea998171.mp4"><img src="docs/images/hybrid-2d-3d.png" alt="Hybrid 2D + 3D — Higgsfield source preview" width="432" /></a><br />
      <strong>Hybrid 2D + 3D</strong><br />
      <sub>Playful brand stories</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="https://d2ol7oe51mr4n9.cloudfront.net/user_3DiY2MbHSIvzM3FG2DOgC6Cf2MM/61a1f7e8-0a71-4f07-87de-8c75b4c69c34.mp4"><img src="docs/images/editorial-collage.png" alt="Editorial collage — Higgsfield source preview" width="432" /></a><br />
      <strong>Editorial collage</strong><br />
      <sub>Ideas & educational shorts</sub>
    </td>
    <td width="50%" valign="top">
      <a href="https://d2ol7oe51mr4n9.cloudfront.net/user_3DiY2MbHSIvzM3FG2DOgC6Cf2MM/d94bfad5-165f-4c27-ba85-bd169b1e3408.mp4"><img src="docs/images/footage-overlays.png" alt="Footage + graphics — Higgsfield source preview" width="432" /></a><br />
      <strong>Footage + graphics</strong><br />
      <sub>Presenters & existing footage</sub>
    </td>
  </tr>
</table>

</details>

## クレジット

- **Chase([@cth9191](https://github.com/cth9191))** は、このプロジェクトの出発点となった元の [motion-design](https://github.com/cth9191/motion-design) スキルを作りました。10 種類のルック、元のプロンプト、アレンジ用のガイドとテンプレート、再生できるギャラリー、プレビュー画像、そして「Motion Design」のワードマークです。ありがとう、Chase。ルックが気に入ったら、ぜひ彼のリポジトリにスターを付けてください。
- 元のプロンプトは、[Higgsfield Marketing Studio の記事](https://higgsfield.ai/@adilinthewildtempo/blogs/claude-fable-5-1-higgsfield-marketing-studio-300-day)で最初に公開されました。
- MCP ページにある Claude と OpenAI のブランドアイコンは、[LobeHub Icons](https://github.com/lobehub/lobe-icons)(MIT)のものです。

Chase のリポジトリから来たファイルは、[ATTRIBUTION.md](ATTRIBUTION.md) に正確に載っています。

## ライセンス

私が書いたものはすべて [MIT ライセンス](LICENSE)です。スタジオ、`kie` CLI、MCP サーバー、レンダリングと仕上げのエンジン、インストーラー、ディレクターガイド、テスト、ドキュメントが含まれます。

ルックと、Chase のリポジトリから来たそのほかのファイルは、MIT ライセンスの対象**ではありません**。それらは彼のもので、クレジットを付けてここで共有しています。彼のリポジトリ自体にはライセンスがありません。一覧は [ATTRIBUTION.md](ATTRIBUTION.md) にあります。

## テスト

```bash
npm test             # CLI
npm run test:mcp     # MCP server
npm run test:web     # studio
npm run validate     # the looks: source hashes, templates and gallery
```
