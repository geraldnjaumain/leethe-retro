# Design System

## Direction

The interface uses a compact dark anodized-aluminum visual language inspired by media applications.
The retro direction is intentional; clarity, contrast, and touch targets take priority over fidelity.

## Tokens

The canonical tokens live in `src/styles.css`.

- Color: `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`,
  `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, aluminum and aqua tokens.
- Radius: `--radius-sm`, `--radius-md`, `--radius-lg`; pills use a full radius.
- Shadows: `--shadow-aqua`, `--shadow-card`, `--shadow-nav`.
- Motion: `--ease-retro`; all decorative motion must collapse under `prefers-reduced-motion`.
- Typography: Helvetica Neue / Lucida Grande / system sans; small labels must remain readable.

## Rules

- Use semantic Tailwind colors or documented CSS utilities before raw values.
- Use `btn-aqua` for the primary action and `chip-pill` for secondary/selection actions.
- Focus must be visible with the ring token.
- Disabled controls remain legible and non-interactive.
- Loading uses skeletons or direct status text. Errors state the failure and recovery action.
- Empty states say what is absent and avoid implying a failure.
- Images use a stable aspect ratio, meaningful alt text when informative, and lazy loading in lists.
- Mobile controls target at least 40px where practical; dense desktop controls may be smaller.
- Dark mode is the supported theme. A light theme is not currently designed or promised.
