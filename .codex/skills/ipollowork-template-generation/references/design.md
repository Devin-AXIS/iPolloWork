# Design Template Rules

Use for Site, Landing, Poster, Social, Email, Report, and Image categories.

- Use semantic HTML landmarks and accessible interactive controls.
- Keep responsive behavior intentional from narrow mobile widths through desktop.
- Keep all visual styling token-driven through `--ipw-*`; keep layout structure in template-owned CSS.
- Use local assets when possible and preserve intrinsic media geometry.
- Define a compact set of reusable content and visual variables that make sense for the selected category.
- Verify focus, hover, contrast, text overflow, empty content, and long localized copy.
- Theme switching may change style but must not rewrite DOM meaning or break responsive layout.
