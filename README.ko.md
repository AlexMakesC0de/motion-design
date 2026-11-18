<div align="center">

<img src="web/public/brand/shard-icon.svg" width="88" height="88" alt="Shard logo">

# Shard

**내 컴퓨터에서 쓰는 AI 영상·이미지 모션 디자인 스튜디오.**

웹 스튜디오, 터미널, 또는 Claude Code와 Codex에서 영상을 기획하고, 장면을 생성하고, 마무리까지 할 수 있습니다.

[![Validate](https://github.com/AlexMakesC0de/shard-motion-design-studio/actions/workflows/validate.yml/badge.svg)](https://github.com/AlexMakesC0de/shard-motion-design-studio/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node 22+](https://img.shields.io/badge/node-22%2B-5FA04E?logo=node.js&logoColor=white)
![macOS](https://img.shields.io/badge/platform-macOS-555)
![Claude Code | Codex](https://img.shields.io/badge/works%20with-Claude%20Code%20%7C%20Codex-B4471C)

[English](README.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **한국어** · [Português (Brasil)](README.pt-BR.md) · [Deutsch](README.de.md)

이 문서는 번역본입니다. 영어판과 내용이 다를 경우 [README.md](README.md)가 기준입니다.

[빠른 시작](#빠른-시작) · [크레딧](#크레딧) · [CLI](cli/README.md) · [MCP 서버](mcp/README.md) · [스튜디오](web/README.md)

</div>

---

Shard는 **[Chase의 motion-design 스킬](https://github.com/cth9191/motion-design)**을 포크해서 시작했습니다. 멋진 모션 스타일 열 가지와 그 뒤에 있는 프롬프트로 이루어진 스킬입니다. Chase에게 진심으로 감사드립니다. 이 저장소의 룩(look)은 모두 그의 작품입니다. 그 주변에 만든 나머지는 전부 새로 만든 것입니다. [크레딧](#크레딧)을 참고하세요.

## 구성

| 구성 요소 | 하는 일 |
|---|---|
| **스튜디오** (`web/`) | 로컬 웹 앱입니다. 이미지·영상 페이지, 장면 단위로 기획하는 영상, 캐릭터·제품·장소 라이브러리, 룩, 내 스킬, 지출 내역과 설정이 있습니다. |
| **`kie` CLI** (`cli/`) | [kie.ai](https://kie.ai)로 영상, 이미지, 오디오를 생성합니다(WaveSpeed는 대체 수단). 모든 작업의 비용을 먼저 계산하고 작업마다 기록을 남깁니다. |
| **MCP 서버** (`mcp/`) | Claude Code, Codex, Claude Desktop에 스튜디오와 같은 도구를 제공해서, 말로 부탁하면 영상을 만들 수 있습니다. |
| **렌더와 마무리** (`render/`, `cli/`) | Remotion으로 제목, 로고, 숫자처럼 정확해야 하는 그래픽을 코드로 그리고, ffmpeg로 음악, 자막, 음량, 다른 화면 비율까지 영상을 마무리합니다. |
| **스킬 라이브러리** (`skills/`) | 즐겨 쓰는 에이전트 스킬을 모아 두는 곳입니다. 각 스킬은 `/slash-command`, MCP 프롬프트, 스튜디오에서 쓸 수 있습니다. `motion-design`에 룩이 들어 있습니다. |

**지출은 어디서나 보호됩니다.** 스튜디오, CLI, 에이전트 어디에서 시작하든 유료 작업은 전송하기 전에 비용을 계산하고, 하루 한도와 선택적인 작업별 한도를 확인합니다. 조회, 기획, 비용 계산은 무료입니다.

## 빠른 시작

**Node 22+**와 **kie.ai API 키**가 필요합니다. ffmpeg는 마무리 작업에만, Python 3.10+는 룩 갤러리를 다시 만들 때만 필요합니다.

1. **코드를 받고 도구를 설치합니다.** 설치 프로그램이 `kie`를 PATH에 추가하고, Claude Code, Codex, Kimi가 설치되어 있으면 스킬을 연결하며, MCP 서버를 등록합니다.

   ```bash
   git clone https://github.com/AlexMakesC0de/shard-motion-design-studio.git
   cd shard-motion-design-studio
   node install.mjs            # --dry-run shows what it would change first
   ```

2. **kie.ai 키를 추가합니다.** 본인만 읽을 수 있게 저장한 뒤 설정을 확인하세요. `kie doctor`는 잔액 조회를 한 번만 하고 아무것도 생성하지 않으며 무료입니다.

   ```bash
   mkdir -p ~/.config/kie
   printf '%s' 'YOUR_KIE_KEY' > ~/.config/kie/key && chmod 600 ~/.config/kie/key
   kie doctor
   ```

3. **예산을 정합니다.** 예를 들어 하루 최대 $25, 작업당 $2로 설정합니다.

   ```bash
   kie limits --daily 25 --per-job 2
   ```

4. **스튜디오를 엽니다.** http://127.0.0.1:4317 에서 실행되며 내 컴퓨터에서만 접속할 수 있습니다.

   ```bash
   npm --prefix web install
   npm run studio
   ```

5. **아니면 에이전트에게 부탁하세요.** Claude Code나 Codex를 다시 시작하고 이렇게 말해 보세요. *"내 앱의 15초짜리 제품 영상을 기획하고, 가격을 보여 주고, 아직 아무것도 생성하지는 마."* 스튜디오의 MCP 페이지에 앱별 설정 명령이 정확히 나와 있습니다.

## 터미널에서 만들어 보기

```bash
kie presets                                        # the ten looks
kie preflight --model seedance-2-5 --duration 10   # what a job would cost, without spending
kie video    --run launch --preset kinetic-typography --duration 10
kie render   --run launch --template logo-reveal --props brand.json
kie assemble --run launch --shot out.mp4 --shot logo-reveal.mp4 --transition fade:0.5
kie variants --run launch --video film.mp4 --ratios 9:16,1:1
```

생성된 영상은 사진 같은 결과물입니다. 그럴듯한 픽셀을 만들어 내는 것이죠. 헤드라인, 로고, 가격처럼 정확해야 하는 요소는 `kie render`로 그려서 영상 위에 얹는 편이 낫습니다. 언제 무엇을 쓸지는 [graphic-motion.md](skills/motion-design/references/graphic-motion.md)에 설명되어 있습니다.

영상, 테이크, 지출 기록은 `runs/`에, 저장한 레퍼런스는 `library/`에 남습니다. 둘 다 git에서 무시됩니다.

## 룩

<!-- The gallery below is Chase's material, kept as he made it. -->
<p align="center"><sub>열 가지 룩과 이 미리보기는 <a href="https://github.com/cth9191/motion-design">Chase의 motion-design 저장소</a>에서 가져왔습니다. 이미지를 클릭하면 원본 영상이 재생됩니다.</sub></p>

<table>
  <tr>
    <td width="33%" valign="top">
      <a href="https://d2ol7oe51mr4n9.cloudfront.net/user_3DiY2MbHSIvzM3FG2DOgC6Cf2MM/fee13558-1de4-46cb-80c6-443935cb8257.mp4"><img src="docs/images/glass-ui-launch.png" alt="Glass UI launch — Higgsfield source preview" width="432" /></a><br />
      <strong>Glass UI launch</strong><br />
      <sub>소프트웨어·제품 출시</sub>
    </td>
    <td width="33%" valign="top">
      <a href="https://d2ol7oe51mr4n9.cloudfront.net/user_3DiY2MbHSIvzM3FG2DOgC6Cf2MM/a95756c8-1f3f-4d93-9ea9-a14832aba4bd.mp4"><img src="docs/images/tropical-product.png" alt="Tropical product — Higgsfield source preview" width="432" /></a><br />
      <strong>Tropical product</strong><br />
      <sub>제품·재료</sub>
    </td>
    <td width="33%" valign="top">
      <a href="https://d2ol7oe51mr4n9.cloudfront.net/user_3DiY2MbHSIvzM3FG2DOgC6Cf2MM/75a6c434-a18a-4484-81b0-387308743279.mp4"><img src="docs/images/kinetic-typography.png" alt="Kinetic typography — Higgsfield source preview" width="432" /></a><br />
      <strong>Kinetic typography</strong><br />
      <sub>공지·애니메이션 타이포</sub>
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <a href="https://d2ol7oe51mr4n9.cloudfront.net/user_3DiY2MbHSIvzM3FG2DOgC6Cf2MM/4e68af0a-c12e-4dd2-9f69-3b523e534ee4.mp4"><img src="docs/images/blueprint-to-building.png" alt="Blueprint to building — Higgsfield source preview" width="432" /></a><br />
      <strong>Blueprint to building</strong><br />
      <sub>건축·부동산</sub>
    </td>
    <td width="33%" valign="top">
      <a href="https://d2ol7oe51mr4n9.cloudfront.net/user_3DiY2MbHSIvzM3FG2DOgC6Cf2MM/9eb4a7a5-d79c-459a-8a8d-593e912aa7a3.mp4"><img src="docs/images/exploded-product.png" alt="Exploded product — Higgsfield source preview" width="432" /></a><br />
      <strong>Exploded product</strong><br />
      <sub>하드웨어·부품 공개</sub>
    </td>
    <td width="33%" valign="top">
      <a href="https://d2ol7oe51mr4n9.cloudfront.net/user_3DiY2MbHSIvzM3FG2DOgC6Cf2MM/eda55630-7def-48c7-b4a8-f73e6022b653.mp4"><img src="docs/images/flat-vector-explainer.png" alt="Flat vector explainer — Higgsfield source preview" width="432" /></a><br />
      <strong>Flat vector explainer</strong><br />
      <sub>앱·간단한 설명</sub>
    </td>
  </tr>
</table>

<details>
<summary><strong>네 가지 스타일 더 보기</strong> — 하이퍼 모션, 2D + 3D 하이브리드, 콜라주, 실사 영상</summary>

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="https://d2ol7oe51mr4n9.cloudfront.net/user_3DiY2MbHSIvzM3FG2DOgC6Cf2MM/d1e752b7-ea6b-4553-98c6-15c8f3bf0cb4.mp4"><img src="docs/images/product-hyper-motion.png" alt="Product hyper-motion — Higgsfield source preview" width="432" /></a><br />
      <strong>Product hyper-motion</strong><br />
      <sub>음식·제품 조립</sub>
    </td>
    <td width="50%" valign="top">
      <a href="https://d2ol7oe51mr4n9.cloudfront.net/user_3DiY2MbHSIvzM3FG2DOgC6Cf2MM/4d56be98-74fb-4616-9269-db37ea998171.mp4"><img src="docs/images/hybrid-2d-3d.png" alt="Hybrid 2D + 3D — Higgsfield source preview" width="432" /></a><br />
      <strong>Hybrid 2D + 3D</strong><br />
      <sub>재치 있는 브랜드 스토리</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="https://d2ol7oe51mr4n9.cloudfront.net/user_3DiY2MbHSIvzM3FG2DOgC6Cf2MM/61a1f7e8-0a71-4f07-87de-8c75b4c69c34.mp4"><img src="docs/images/editorial-collage.png" alt="Editorial collage — Higgsfield source preview" width="432" /></a><br />
      <strong>Editorial collage</strong><br />
      <sub>아이디어·교육용 숏폼</sub>
    </td>
    <td width="50%" valign="top">
      <a href="https://d2ol7oe51mr4n9.cloudfront.net/user_3DiY2MbHSIvzM3FG2DOgC6Cf2MM/d94bfad5-165f-4c27-ba85-bd169b1e3408.mp4"><img src="docs/images/footage-overlays.png" alt="Footage + graphics — Higgsfield source preview" width="432" /></a><br />
      <strong>Footage + graphics</strong><br />
      <sub>진행자·기존 영상</sub>
    </td>
  </tr>
</table>

</details>

## 크레딧

- **Chase ([@cth9191](https://github.com/cth9191))**는 이 프로젝트의 바탕이 된 원조 [motion-design](https://github.com/cth9191/motion-design) 스킬을 만들었습니다. 열 가지 룩, 원본 프롬프트, 적용 가이드와 템플릿, 재생 가능한 갤러리, 미리보기 스틸, 그리고 "Motion Design" 워드마크까지 모두 그의 것입니다. 고마워요, Chase. 룩이 마음에 드셨다면 그의 저장소에 별을 눌러 주세요.
- 원본 프롬프트는 [Higgsfield Marketing Studio 글](https://higgsfield.ai/@adilinthewildtempo/blogs/claude-fable-5-1-higgsfield-marketing-studio-300-day)에 처음 실렸습니다.
- MCP 페이지의 Claude와 OpenAI 브랜드 아이콘은 [LobeHub Icons](https://github.com/lobehub/lobe-icons)(MIT)에서 가져왔습니다.

Chase의 저장소에서 가져온 파일이 정확히 어느 것인지는 [ATTRIBUTION.md](ATTRIBUTION.md)에 정리되어 있습니다.

## 라이선스

제가 직접 작성한 모든 것은 [MIT 라이선스](LICENSE)를 따릅니다. 스튜디오, `kie` CLI, MCP 서버, 렌더와 마무리 엔진, 설치 프로그램, 디렉터 가이드, 테스트, 문서가 해당합니다.

룩과 Chase의 저장소에서 가져온 나머지 파일은 MIT 라이선스의 적용 대상이 **아닙니다**. 그것들은 Chase의 것이며, 출처를 밝히고 여기에 공유한 것입니다. 그의 저장소에는 별도의 라이선스가 없습니다. 해당 파일 목록은 [ATTRIBUTION.md](ATTRIBUTION.md)에 있습니다.

## 테스트

```bash
npm test             # CLI
npm run test:mcp     # MCP server
npm run test:web     # studio
npm run validate     # the looks: source hashes, templates and gallery
```
