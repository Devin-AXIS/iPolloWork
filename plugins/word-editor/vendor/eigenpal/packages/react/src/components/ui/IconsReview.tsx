/**
 * Inline SVG Icons - Material Symbols, the review and protection set.
 *
 * Official Material Symbols from Google Fonts, bundled as inline SVGs.
 * Source: https://fonts.google.com/icons
 *
 * Split from `Icons.tsx` at its line cap; `scripts/extract-icons.mjs` reads both files.
 */

import { SvgIcon, type IconProps } from './icon-base';

export function IconDoneAll(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M268-240 42-466l57-56 170 170 56 56-57 56Zm226 0L268-466l56-57 170 170 368-368 57 57-425 424Zm0-226-57-56 198-198 57 56-198 198Z" />
    </SvgIcon>
  );
}

export function IconCheckCircle(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="m424-296 282-282-56-56-226 226-114-114-56 56 170 170Zm56 216q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z" />
    </SvgIcon>
  );
}

/** Plain speech bubble outline (no lines inside) */
export function IconChatBubbleOutline(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v525l46-45Zm-46 0v-480 480Z" />
    </SvgIcon>
  );
}

/** Speech bubble with green checkmark (bubble inherits color, check is green) */
export function IconChatBubbleCheck(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v525l46-45Zm-46 0v-480 480Z" />
      <path fill="var(--doc-success)" d="m421-380 227-227-45-45-182 182-92-91-45 45 137 136Z" />
    </SvgIcon>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z" />
    </SvgIcon>
  );
}

export function IconClose(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" />
    </SvgIcon>
  );
}

export function IconAddComment(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M440-400h80v-120h120v-80H520v-120h-80v120H320v80h120v120ZM80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v525l46-45Zm-46 0v-480 480Z" />
    </SvgIcon>
  );
}

export function IconComment(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M240-400h480v-80H240v80Zm0-120h480v-80H240v80Zm0-120h480v-80H240v80ZM80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v525l46-45Zm-46 0v-480 480Z" />
    </SvgIcon>
  );
}

export function IconEditNote(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M160-400h280v-80H160v80Zm0-160h440v-80H160v80Zm0-160h440v-80H160v80Zm360 360v-123l221-220q9-9 20-13t22-4q12 0 23 4.5t20 13.5l37 37q8 9 12.5 20t4.5 22q0 11-4 22.5T863-380L643-160H520Zm300-263-37-37 37 37ZM580-220h38l121-122-18-19-19-18-122 121v38Zm141-141-19-18 37 37-18-19Z" />
    </SvgIcon>
  );
}

export function IconDifference(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M500-520h80v-80h80v-80h-80v-80h-80v80h-80v80h80v80Zm-80 160h240v-80H420v80ZM320-200q-33 0-56.5-23.5T240-280v-560q0-33 23.5-56.5T320-920h280l240 240v400q0 33-23.5 56.5T760-200H320Zm0-80h440v-360L560-840H320v560ZM160-40q-33 0-56.5-23.5T80-120v-560h80v560h440v80H160Zm160-240v-560 560Z" />
    </SvgIcon>
  );
}

export function IconRateReview(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M240-400h122l200-200q9-9 13.5-20.5T580-643q0-11-5-21.5T562-684l-36-38q-9-9-20-13.5t-23-4.5q-11 0-22.5 4.5T440-722L240-522v122Zm280-243-37-37 37 37ZM300-460v-38l101-101 20 18 18 20-101 101h-38Zm121-121 18 20-38-38 20 18Zm26 181h273v-80H527l-80 80ZM80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v525l46-45Zm-46 0v-480 480Z" />
    </SvgIcon>
  );
}

export function IconVisibility(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M480-320q75 0 127.5-52.5T660-500q0-75-52.5-127.5T480-680q-75 0-127.5 52.5T300-500q0 75 52.5 127.5T480-320Zm0-72q-45 0-76.5-31.5T372-500q0-45 31.5-76.5T480-608q45 0 76.5 31.5T588-500q0 45-31.5 76.5T480-392Zm0 192q-146 0-266-81.5T40-500q54-137 174-218.5T480-800q146 0 266 81.5T920-500q-54 137-174 218.5T480-200Zm0-300Zm0 220q113 0 207.5-59.5T832-500q-50-101-144.5-160.5T480-720q-113 0-207.5 59.5T128-500q50 101 144.5 160.5T480-280Z" />
    </SvgIcon>
  );
}

/** Material Symbols lock: Word's Protect Document. */
export function IconLock(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm0-80h480v-400H240v400Zm240-120q33 0 56.5-23.5T560-360q0-33-23.5-56.5T480-440q-33 0-56.5 23.5T400-360q0 33 23.5 56.5T480-280ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80Zm-120 480v-400 400Z" />
    </SvgIcon>
  );
}
