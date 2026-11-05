# Core Site Shared Contract

The global library owns structural fragments. The active template owns visual identity, responsive tokens, brand assets and runtime behavior.

Each file contains one `<template data-ipw-layout="...">` and a scoped `<style data-layout-styles="...">`. Copy the template fragment and scoped styles only, replace every sample value, and add a unique ID when repeating it.

Do not copy `html`, `body`, preview-only `aside`, `main`, `:root` defaults, external fonts or scripts. Keep the target `design-tokens.css` link and bind colors, typography, spacing, radii and surfaces to its semantic `--ipw-*` tokens.

Required metadata: `data-ipw-layout`, `data-slot`, `data-layout-description` and `data-layout-capacity`. Images keep real image semantics and `alt`; interactive links need real destinations or clearly labeled local prototype behavior. Never hide required content to make a screenshot fit. After insertion inspect heading endings, body measure, crops, focus, overflow and actual links.
