# Compositions

A composition is an HTML document that defines a video timeline.

## Structure

Every composition needs a root element with `data-composition-id`:

```html
<div id="root" data-composition-id="root" data-width="1920" data-height="1080">
  <!-- Elements go here -->
</div>
```

## Nested Compositions

Embed one composition inside another:

```html
<div data-composition-src="./intro.html" data-start="0" data-duration="5"></div>
```

## Listing Compositions

Use `npx hyperframes compositions` to see all compositions in a project.

## Variables

Two attributes with different shapes and different jobs:

- **`data-composition-variables`** on the `<html>` root — a JSON **array of declarations** (`{id, type, label, default}` per entry). Defines the schema: which variables exist, what type they are, and what defaults to use when no override is provided.
- **`data-variable-values`** on a sub-comp host element — a JSON **object keyed by variable id** (`{"title":"Pro","price":"$29"}`). Carries per-instance overrides for that one mount of the sub-composition.

They aren't redundant — one is "what variables does this composition have?" and the other is "what values should this particular embed use?" Inside any composition script, `window.__hyperframes.getVariables()` returns the merged result. Layering, lowest to highest precedence:

1. Declared defaults from `data-composition-variables`
2. Per-instance overrides from the host's `data-variable-values` (sub-comp embeds only)
3. CLI overrides from `npx hyperframes render --variables '{...}'` (top-level renders only)

```html
<!-- compositions/card.html -->
<html data-composition-variables='[
  {"id":"title","type":"string","label":"Title","default":"Hello"},
  {"id":"color","type":"color","label":"Color","default":"#111827"}
]'>
  <body>
    <div data-composition-id="card" data-width="1920" data-height="1080">
      <h1 class="title"></h1>
      <script>
        const { title, color } = window.__hyperframes.getVariables();
        document.querySelector(".title").textContent = title;
        document.querySelector(".title").style.color = color;
      </script>
    </div>
  </body>
</html>
```

```html
<!-- index.html — embed twice with different per-instance values -->
<div data-composition-id="card-pro" data-composition-src="compositions/card.html"
     data-variable-values='{"title":"Pro","color":"#ff4d4f"}'></div>
<div data-composition-id="card-enterprise" data-composition-src="compositions/card.html"
     data-variable-values='{"title":"Enterprise","color":"#22c55e"}'></div>
```

The runtime layers `data-variable-values` over the sub-comp's declared defaults on a per-instance basis. The same `getVariables()` call works at the top level too — the CLI flag `--variables` provides the override, declared `default`s fall through for missing keys.
