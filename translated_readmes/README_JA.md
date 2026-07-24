# iPolloWork

<p align="center">
  <a href="../README.md">English</a> · <a href="./README_ZH.md">简体中文</a> · <a href="./README_ZH_hk.md">繁體中文</a> · 日本語
</p>

**一つの目的から編集可能なコード・文書・プレゼン・Webサイト・デザイン・動画まで作れる、ローカルファーストのビジュアルAIワークベンチであり、CodexとClaude Codeのソースアベイラブルな代替です。**

https://github.com/user-attachments/assets/201b561a-22ec-4c8e-a4e8-f34172cf0aa3

iPolloWork は、リポジトリ、ローカルファイル、ブラウザ操作、ドキュメント、プレゼンテーション、Web サイト、デザイン、動画を一つのワークスペースで扱える AI エージェント環境です。目的を伝えると、エージェントが計画して実行します。ユーザーは手順を確認し、操作を承認し、同じ場所で成果物を編集し続けられます。

Codex のようなコーディングは出発点にすぎません。成果物がスライド、Web ページ、ビジュアルデザイン、動画になっても、完成ファイルやチャットの回答で終わらず、そのまま編集できます。

## iPolloWork の違い

- **エージェント中心の実行** — 作業を計画し、ツールを使い、ファイルを読み書きし、コマンドを実行し、現在の状態から作業を続けます。
- **編集可能な成果物** — コードからドキュメント、Web サイト、スライド、デザイン、動画まで、生成後もテキスト、画像、レイアウト、シーンを変更できます。
- **ローカルで管理** — 自分の端末で実行し、任意のモデルやプロバイダーを接続し、権限を承認し、Skills、プラグイン、MCP サーバー、ブラウザ自動化で拡張できます。

## 簡単に言うと

iPolloWork は、Codex のようなエージェントに、可視化されたローカルファーストの作業環境を組み合わせたものです。チャットだけのラッパーではなく、ローカル利用に iPolloCloud アカウントは必要ありません。

このソースアベイラブルなリポジトリに含まれるのは、Work クライアントとそのローカルランタイム統合です。アカウント、組織管理、ホスト型 Worker の管理、決済、モバイルアプリは独立した iPolloCloud の機能であり、ローカル利用には必要ありません。

## iPolloWork のインストール

### デスクトップ版をダウンロードする

公開インストーラーが提供されると、[GitHub Releases](https://github.com/Devin-AXIS/iPolloWork/releases) に掲載されます。現在、このリポジトリには公開リリースがないため、現時点では下記のソースからのインストール方法を利用してください。将来リリース版をダウンロードする際は、オペレーティングシステムと CPU の両方に合ったファイルを選択してください。

| システム | CPU | 使用するインストーラー |
| --- | --- | --- |
| macOS | Apple Silicon（M シリーズ） | `ipollowork-mac-arm64-<version>.dmg` |
| macOS | Intel | `ipollowork-mac-x64-<version>.dmg` |
| Windows | Intel/AMD 64 ビット | `ipollowork-win-x64-<version>.exe` |
| Windows | ARM64 | `ipollowork-win-arm64-<version>.exe` |
| Linux | Intel/AMD 64 ビット | `ipollowork-linux-x64-<version>.AppImage` |
| Linux | ARM64 | `ipollowork-linux-arm64-<version>.AppImage` |

macOS の `.zip` と Linux の `.tar.gz` は、ポータブル実行や更新用のアーティファクトです。通常は `.dmg`、`.exe`、または `.AppImage` を選択してください。Releases ページにお使いのシステム向けのインストーラーがまだない場合は、下記の手順でソースから実行するか、自分でパッケージ化してください。

インストール後の手順：

- **macOS：** `.dmg` を開き、**iPolloWork** を「アプリケーション」フォルダーへドラッグします。
- **Windows：** `.exe` インストーラーを実行します。ローカルでビルドした署名なしのインストーラーでは、Microsoft Defender SmartScreen が表示される場合があります。
- **Linux：** `chmod +x ipollowork-*.AppImage` で AppImage に実行権限を付与してから起動します。`.tar.gz` パッケージは展開して、インストールせずに実行することもできます。

### ソース開発とパッケージ化の要件

- [Git](https://git-scm.com/downloads)
- [Node.js](https://nodejs.org/en/download) 22 以降
- pnpm 11（`corepack enable` で Corepack を有効化）
- [Bun](https://bun.sh/docs/installation) 1.3.10 以降（ローカルの Orchestrator サイドカーのビルドに使用）
- macOS：Xcode Command Line Tools（`xcode-select --install` を実行）
- Windows：[Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) の **Desktop development with C++** と Windows SDK。PowerShell またはコマンドプロンプトを使用してください。
- Linux：C/C++ ツールチェーン、Python 3、`pkg-config`、Electron に必要なデスクトップライブラリを含む標準的な Electron ビルド環境。リリースビルドでは Ubuntu 22.04 を使用します。

OpenCode は、最初のデスクトップビルド時に独立したサイドカーとしてダウンロード・準備されます。iPolloWork は OpenCode をフォークしたり書き換えたりせず、OpenCode は独立してアップグレードを続けられます。

## ソースから起動する

### macOS と Linux

```bash
git clone https://github.com/Devin-AXIS/iPolloWork.git
cd iPolloWork
corepack enable
./ipollowork setup
./ipollowork dev
```

### Windows PowerShell

```powershell
git clone https://github.com/Devin-AXIS/iPolloWork.git
Set-Location iPolloWork
corepack enable
.\ipollowork.cmd setup
.\ipollowork.cmd dev
```

`setup` コマンドはロックされたワークスペース依存関係をインストールします。`dev` コマンドは OpenCode と Orchestrator のサイドカーを準備し、UI を起動して Electron デスクトップクライアントを開きます。開発モードでは iPolloWork と OpenCode の状態を分離して使用するため、普段使っている OpenCode の設定を上書きしません。

### 開発コマンド

| 目的 | macOS / Linux | Windows |
| --- | --- | --- |
| デスクトップアプリを起動 | `./ipollowork dev` | `.\ipollowork.cmd dev` |
| ブラウザー UI のみ起動 | `./ipollowork dev:ui` | `.\ipollowork.cmd dev:ui` |
| ローカル Cloud に接続 | `./ipollowork dev:cloud http://localhost:3100` | `.\ipollowork.cmd dev:cloud http://localhost:3100` |
| 型チェックとデスクトップテスト | `./ipollowork check` | `.\ipollowork.cmd check` |
| 本番ビルド | `./ipollowork build` | `.\ipollowork.cmd build` |

Windows の開発ビルドでは、本番用の `ipollowork://` ハンドラーは自動登録されません。外部ブラウザーから Cloud サインインをテストする場合は、リポジトリにあるプロトコル切り替えツールを使用し、終了後に本番用ハンドラーへ戻してください。詳しくは [Windows プロトコル切り替え](../docs/windows-protocol-switcher.md) を参照してください。

## ビルドとパッケージ化

ビルドには、次の3つのレベルがあります。

| コマンド | 結果 |
| --- | --- |
| `build` | 本番用 UI、server、Electron シェル、サイドカーをコンパイルします。インストーラーは作成しません。 |
| `package:dir` | ローカル確認用に、最も短時間で展開済みデスクトップアプリを作成します。リリースバージョンは変更しません。 |
| `package` | チェックを実行し、クライアントバージョンを更新した後、現在のシステムと CPU 向けのネイティブインストーラーおよびポータブル／更新用アーティファクトを公開せずに作成します。 |

### macOS と Linux

```bash
./ipollowork check
./ipollowork package:dir
./ipollowork package
```

### Windows PowerShell

```powershell
.\ipollowork.cmd check
.\ipollowork.cmd package:dir
.\ipollowork.cmd package
```

すべての成果物は `apps/desktop/dist-electron/` に出力されます。

`package` はローカルリリース用のコマンドです。App、Desktop、Orchestrator、Server のバージョンを同期し、`0.1.0` から `0.99.0`、続いて `1.0.0` へ進むバージョン系列を使用します（ソースチェックアウトの開始点は、未出荷のベースライン `0.0.0` です）。次のバージョンを確認するには `./ipollowork package --dry-run` を使用してください。`--skip-check` はチェックがすでに通過している場合にのみ使用してください。ローカルのパッケージ化で、コミット、タグ作成、プッシュ、リリース公開が自動的に行われることはありません。

- **macOS：** `.dmg`、`.zip`、展開済みの `.app`
- **Windows：** NSIS `.exe` と `win-unpacked/`
- **Linux：** `.AppImage`、`.tar.gz`、`linux-unpacked/`

ローカルのパッケージ化では、現在のオペレーティングシステムと CPU アーキテクチャのみが対象になります。macOS ARM64/x64、Windows ARM64/x64、Linux ARM64/x64 の完全な署名・公証済みマトリクスを作成するには、GitHub のリリースワークフローを使用してください。適切な Apple または Windows の署名資格情報がない場合、ローカルパッケージには署名されません。これらは開発テスト用であり、公式リリースとして扱わないでください。

## iPolloCloud に接続する

まずローカルの iPolloCloud コントロールプレーンを起動し、次を実行します。

```bash
./ipollowork dev:cloud http://localhost:3100
```

このコマンドは分離された開発プロファイルを作成し、認証と Cloud API を指定された URL に向け、Cloud へのサインインを必要とします。通常のローカル iPolloWork プロファイルは変更しません。リモートまたはセルフホストの Cloud URL でも同じように動作します。

```bash
./ipollowork dev:cloud https://cloud.example.com
```

## アーキテクチャの境界

```text
iPolloWork desktop/UI ── local API ──> iPolloWork server ──> OpenCode
          │
          └── optional account/control requests ──> iPolloCloud
```

- エージェントの実行とストリーミングは、Work/Worker パス上で行われます。
- iPolloCloud は、ID、組織、権限、ホスト型 Worker のライフサイクル、管理機能、商用アプリを担当します。
- Cloud 接続は任意です。ローカルの iPolloWork は、アカウントや商用サービスなしで動作します。
- OpenCode は独立したコンポーネントのままであり、独立してアップグレードを続けられます。

## リポジトリ構成

- `apps/app` — 共有 React ユーザーインターフェース
- `apps/desktop` — Electron デスクトップシェルとパッケージ化
- `apps/server` — iPolloWork サーバー API
- `apps/orchestrator` — ヘッドレスランタイムオーケストレーション
- `packages` — 共有型、コンポーネント、ドキュメント、インテグレーション

## コントリビューション

プロダクトを変更する前に、`AGENTS.md`、`VISION.md`、`PRINCIPLES.md`、`PRODUCT.md`、`ARCHITECTURE.md` を読んでください。まず関連する範囲のテストを実行し、その後に次を実行します。

```bash
./ipollowork check
git diff --check
```

コントリビューション、コミュニティ、セキュリティに関する方針は、`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`SECURITY.md` を参照してください。

## ライセンス

iPolloWork は **iPolloWork Source Available License 1.0** を使用します。

- 個人による自己利用、および合計3人未満の小規模な社内利用に限り無料です。
- 個人・社内・商用・非商用・個人事業・組織利用のいずれであるかを問わず、3人以上による利用には事前の書面による許可が必要です。
- 個人または企業によるものかを問わず、販売、再販、有料サービス、SaaS、ホスティング、ホワイトラベル配布、マーケットプレイスでの利用、顧客向け利用には、事前の書面による許可が必要です。
- 事前の書面による許可で別のブランディングが明示的に認められていない限り、ユーザー向けフロントエンド表示には iPolloWork の名称、ロゴ、製品帰属表示を残す必要があります。
- 個別にライセンスされたサードパーティコンポーネント、および過去に MIT ライセンスで公開されたコードには、それぞれの元のライセンスと既存の権利が引き続き適用されます。

適用される条項は [`LICENSE`](../LICENSE) を参照してください。これはソースアベイラブルライセンスであり、OSI が承認するオープンソースライセンスではありません。
