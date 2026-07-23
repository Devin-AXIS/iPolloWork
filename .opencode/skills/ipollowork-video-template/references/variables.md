# Variable system

- [Current manifest V1](#current-manifest-v1)
- [Current bundled video variables](#current-bundled-video-variables)
- [Planning taxonomy](#planning-taxonomy)
- [Recommended public variables](#recommended-public-variables)
- [Binding contract](#binding-contract)
- [Variable decision test](#variable-decision-test)
- [Future variable protocol](#future-variable-protocol)

## Current manifest V1

The current strict manifest accepts only:

```json
{
  "id": "title",
  "label": "Title",
  "type": "text",
  "group": "content"
}
```

Supported types:

- `color`
- `font`
- `number`
- `text`
- `image`
- `boolean`
- `select`

Supported groups:

- `theme`
- `background`
- `typography`
- `components`
- `content`
- `brand`

Do not write `scope`, `domain`, `default`, `required`, `locked`, `constraints`, or `binding` into manifest V1 variable objects. The schema is strict and rejects them. Use the taxonomy below while planning, encode defaults in `data-composition-variables`, and encode bindings in HTML/CSS. Add richer fields only after a future manifest schema version supports them.

Manifest types and HyperFrames composition-metadata types are related but not identical:

| Manifest V1 type | `data-composition-variables` type |
| --- | --- |
| `text` | `string` |
| `image` | `string` |
| `font` | `string` |
| `select` | `string` |
| `color` | `color` |
| `number` | `number` |
| `boolean` | `boolean` |

Use the manifest vocabulary only in `manifest.json` and the HyperFrames vocabulary only in `data-composition-variables`. Keep the same ID, label, and semantic value across both declarations.

## Current bundled video variables

All 14 current bundled video templates share:

| ID | Type | Group | Purpose |
| --- | --- | --- | --- |
| `title` | text | content | primary title |
| `brandName` | text | brand | visible brand name |
| `logoUrl` | image | brand | brand logo source |
| `accent` | color | theme | primary highlight color |

Additional current IDs:

| Family | IDs |
| --- | --- |
| product | `tagline`, `featureA`, `featureB`, `featureC`, `cta` |
| brand | `descriptor`, `keyword` |
| code | `question`, `codeLabel`, `result` |
| data | `metric`, `metricLabel`, `insight`, `source` |
| course | `chapter`, `definition`, `example`, `takeaway` |

Reuse an existing ID when its meaning matches. Do not reuse `source` for a media URL or `result` for unrelated body copy.

## Planning taxonomy

Classify every proposed variable on two independent axes:

### Scope

- **global**: shared across the composition, such as brand and palette;
- **scene**: owned by one story beat, such as a scene title or metric;
- **component**: configures a reusable component, such as chart labels or reveal style.

### Domain

- **content**: copy, labels, CTA, verified data;
- **visual**: colors, fonts, backgrounds, style intensity;
- **media**: images, video, models, audio sources;
- **timing**: duration, stagger, transition length;
- **audio**: voice, volume, captions, ducking;
- **behavior**: optional scenes, effect toggles, chart or transition choice.

A visual variable can be global or component-scoped. “Global variable” and “visual variable” are not competing categories.

## Recommended public variables

Expose only variables the user can change without breaking composition integrity.

| Scope | Domain | Suggested IDs |
| --- | --- | --- |
| global | brand | `brandName`, `logoUrl` |
| global | visual | `primaryColor`, `secondaryColor`, `accent`, `backgroundColor`, `textColor`, `mutedTextColor` |
| global | typography | `fontDisplay`, `fontBody`, `fontMono` |
| global/scene | content | `eyebrow`, `title`, `subtitle`, `description`, `keyword`, `tagline`, `cta`, `footerText`, `legalText` |
| global/scene | media | `heroImage`, `backgroundImage`, `productScreenshot`, `avatarImage`, `posterImage` |
| scene/component | data | `metric`, `metricLabel`, `metricUnit`, `insight`, `source`, `chartType` |
| global/component | behavior | `motionIntensity`, `transitionStyle`, `captionsEnabled`, `grainEnabled`, `particlesEnabled` |

Manifest V1 has no array or object type. Keep data series internal or serialize them through an agreed text format until a later schema version adds structured values.

Composition format values such as width, height, duration, frame rate, language, and scene count belong to project or composition settings. Do not expose width and height independently unless the product supports a safe aspect-ratio migration.

## Binding contract

Declare defaults on the root HTML element:

```html
<html
  data-composition-variables='[
    {"id":"title","type":"string","label":"Title","default":"Launch what matters"},
    {"id":"accent","type":"color","label":"Accent","default":"#68f6c1"}
  ]'
>
```

Bind text and image variables:

```html
<h1 data-var-text="title">Launch what matters</h1>
<img data-var-src="logoUrl" src="assets/logo.svg" alt="Brand logo" />
```

Bind visual variables through CSS custom properties:

```css
:root {
  --accent: #68f6c1;
  --background-color: #060910;
  --text-color: #f5f7fb;
  --muted-text-color: #9aa5b5;
}
```

Prefer a future normalized `--ipw-video-*` namespace for new shared visual tokens, but preserve existing published token names while editing a template.

## Variable decision test

Expose a value only when all are true:

1. A non-technical user understands the label.
2. Changing it produces a useful variant.
3. Its valid range can be constrained.
4. The composition remains valid without manually rewriting selectors or timing.
5. The value has a real HTML, CSS, media, or component binding.

Keep these locked:

- composition and scene IDs;
- DOM IDs used by GSAP;
- track indices and track roles;
- selector names and timeline registration;
- media playback control;
- required root attributes;
- component input names after publication;
- internal offsets such as `--dx` and `--dy`.

## Future variable protocol

When manifest V2 is designed, use a richer descriptor:

```json
{
  "id": "title",
  "label": "Title",
  "scope": "scene",
  "domain": "content",
  "type": "text",
  "default": "Build faster",
  "required": true,
  "locked": false,
  "constraints": { "maxLength": 40 },
  "binding": "[data-var-text='title']"
}
```

Do not emulate this by adding unrecognized fields to V1.
