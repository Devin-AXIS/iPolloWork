# DejaVu Sans test fixtures

These fixtures are unmodified files from the authoritative DejaVu Fonts 2.37 release:

- Release: https://github.com/dejavu-fonts/dejavu-fonts/releases/tag/version_2_37
- Archive: `dejavu-fonts-ttf-2.37.zip`
- `DejaVuSans.ttf` SHA-256: `7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954`
- `DejaVuSans-Bold.ttf` SHA-256: `e6476c1b80502924294eed40894c5b18e06c181444ca953e5334262df9c27724`

Copyright © 2003 by Bitstream, Inc. All Rights Reserved. DejaVu changes are in the public domain. The exact upstream license and attribution text is retained verbatim in `DejaVu-LICENSE.txt`.

# Noto Sans CJK JP kana subset

`NotoSansCJKjp-kana.subset.otf` is a subset of Noto Sans CJK JP Regular, the face that `@docx-editor.dev/fonts-cjk` ships in `packages/fonts-cjk/assets/`. It keeps the `kern` and `palt` features for the kana, ideographs, and Latin letters that `east-asian-kerning.test.ts` shapes. Reproduce it with FontTools `pyftsubset`, `--text="アイウエオカキクケコあいうえおかきくけこ漢字国AVATo "`, `--layout-features='kern,palt'`, and `--name-IDs='*' --name-languages='*' --name-legacy`. The SIL Open Font License text is in `NotoSansCJK-OFL.txt`.

# Sound mark test faces

`sound-mark-spacing.ttf`, `sound-mark-joining.ttf`, and `sound-mark-circle.ttf` are synthetic faces made for `sound-mark-spacing.test.ts` with FontTools `FontBuilder`. Each maps `あかがはぱ国`, U+3099, U+309A, U+309B, U+309C, U+25CC, and a space, on a 1000-unit em. Every glyph is one rectangle with a 1000-unit advance, except the 500-unit dotted circle.

- The spacing face has no `GDEF` table and draws the sound marks at the left of their own cell.
- The joining face classes U+3099 and U+309A as marks (`GDEF` class 3), draws them at the right of their cell, and has one `GPOS` kerning pair, so the shaper does not move a zero-width mark back over its base.
- The circle face is the joining face with a `ccmp` substitution that draws a lone mark on a dotted circle.

License: the faces are original to this repository. They contain no third-party outlines and are covered by the repository license. Their `name` table states the same in its copyright and license records.
