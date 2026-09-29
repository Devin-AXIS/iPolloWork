// 字距呼吸展开（tracking-expand-reveal）——电影片头字幕惯用的 letter-spacing 入场。
// 标题 "BREATHE"（150px）出场时字符几乎叠压（相当于 letter-spacing -0.42em），
// 50 帧内展开到 0.14em，同步 blur 10px→0、opacity 0.6→1、scaleX 0.92→1。
// 不动 letter-spacing 本身（逐帧重排会抖）：容器常量 letterSpacing 0.14em 定终位，
// 逐字符 span 用 translateX 手动插值——第 i 字起始位移 = (i - 中心) × 每缝差值 84px，
// 全部挤向词心，位移只与字缝有关、与字宽无关，天然对中。
// 关键帧：0–50 展开（Easing.out(poly(5)))＋去糊提亮 → 35–58 副标题淡入（≈主词展开 70% 时点）
// → 58–130 全静止（≥72f，滤镜彻底摘除）。
import React from 'react';
import { useCurrentFrame, interpolate, Easing } from 'remotion';
import { G, TitleBlock } from '../../_fixtures/Fixtures';

const WORD = 'BREATHE';
const FS = 150; // 主词字号
// 每个字缝的起始-终点差：(-0.42em) - (0.14em) = -0.56em = -84px @150px
const GAP_DELTA = -0.56 * FS;

export const TrackingExpandReveal: React.FC = () => {
  const frame = useCurrentFrame();
  // 展开进度 0→1（0–50f，out poly(5)）
  const p = interpolate(frame, [0, 50], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.poly(5)),
  });
  const blur = 10 * (1 - p);
  const op = interpolate(p, [0, 1], [0.6, 1]);
  const sx = interpolate(p, [0, 1], [0.92, 1]);
  // 副标题：主词时间轴走到 70%（帧 35）起淡入
  const subOp = interpolate(frame, [35, 58], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.quad),
  });

  const N = WORD.length;
  const center = (N - 1) / 2;
  const settled = frame >= 50; // 展开完成后摘掉一切滤镜/变换，保证逐帧完全相同

  return (
    <div style={{ width: 1920, height: 1080, background: G.bg, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 120, top: 96 }}>
        <TitleBlock text="TRACKING EXPAND REVEAL" size={54} />
      </div>

      {/* 主词：容器 letterSpacing 恒为 0.14em（终态），字符仅做 translateX */}
      <div
        style={{
          position: 'absolute',
          top: 430,
          left: 0,
          width: 1920,
          display: 'flex',
          justifyContent: 'center',
          transform: settled ? undefined : `scaleX(${sx})`,
          filter: settled ? undefined : `blur(${blur}px)`,
          opacity: settled ? 1 : op,
        }}
      >
        <div
          style={{
            fontFamily: 'Helvetica, Arial, sans-serif',
            fontWeight: 800,
            fontSize: FS,
            color: G.ink,
            letterSpacing: '0.14em',
            whiteSpace: 'pre',
            // letter-spacing 只加在字后，整体左移半个缝宽找回视觉对中
            marginLeft: 0.14 * FS * 0.5,
          }}
        >
          {WORD.split('').map((ch, i) => {
            const tx = (1 - p) * (i - center) * GAP_DELTA;
            return (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  transform: settled ? undefined : `translateX(${tx}px)`,
                }}
              >
                {ch}
              </span>
            );
          })}
        </div>
      </div>

      {/* 副标题：主词展开 70% 时点淡入 */}
      <div
        style={{
          position: 'absolute',
          top: 630,
          left: 0,
          width: 1920,
          textAlign: 'center',
          fontFamily: 'Helvetica, Arial, sans-serif',
          fontWeight: 500,
          fontSize: 34,
          color: G.mid,
          letterSpacing: '0.32em',
          opacity: frame >= 58 ? 1 : subOp,
        }}
      >
        A CINEMATIC TITLE ENTRANCE
      </div>
    </div>
  );
};
