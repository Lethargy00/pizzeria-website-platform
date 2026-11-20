# `@pwp/schema/theme`

The theme token contract (#34). A starter theme in `packages/themes` defines a complete
`ThemeTokens` set. A tenant's `theme.yaml` is a `ThemeOverride`: the same shape with every key
optional. `applyThemeOverride(base, override)` gives the tenant's final token set. CSS generation
(#35) and the contrast gate (#36) build on this contract and are not part of it.

```ts
import { ThemeOverride, ThemeTokens, applyThemeOverride } from '@pwp/schema/theme';

const tokens = applyThemeOverride(ThemeTokens.parse(base), ThemeOverride.parse(tenantYaml));
```

## Value grammar

Every token value goes into generated CSS, so each one is an anchored pattern, an enum or a
number. There is no free-text CSS anywhere in the contract.

| Value       | Accepted                                                                     | Examples                                          |
| ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------- |
| Color       | `#rgb`, `#rrggbb` (either case), `oklch(L C H)` in lowercase, single spaces  | `#fffaf0`, `oklch(62.8% 0.258 29.23)`             |
| Length      | `0`, or 0–999.9999 with `px`, `rem` or `em`                                  | `1rem`, `0.75rem`, `4px`                          |
| Shadow x/y  | a length that may be negative                                                | `-4px`                                            |
| Font weight | 100–900 in steps of 100                                                      | `400`, `700`                                      |
| Line height | a unitless number from 1 to 3                                                | `1.5`                                             |
| Font name   | ASCII letters and digits, words separated by one space or hyphen, ≤ 64 chars | `Playfair Display`, `Source Sans 3`               |
| Font file   | a `FontRef` (`assets/…/*.woff2`)                                             | `assets/fonts/inter-regular.woff2`                |
| Enums       | `buttonStyle`, `imageTreatment`, `darkMode`, font `style` and `fallback`     | `pill`, `full-bleed`, `system`, `italic`, `serif` |

So `url(`, `;`, `{`, `}`, `@import`, `expression(`, `var(`, `calc(`, quotes, backslashes and
comments are rejected everywhere. Alpha channels, named colors, `%` lengths and `calc()` are not
accepted. Shadows are structured (`x`, `y`, `blur`, `spread`, `color`, `opacity`) or `none`.

Fonts are always self-hosted: a family has a name, one to eight WOFF2 faces and a generic
fallback (`serif`, `sans-serif`, `monospace` or `system-ui`). No other font is ever named. A face's
`src` is resolved against the folder of the file that declares it: the theme package for a
starter theme, the tenant folder for `theme.yaml`. The build fails if the file is missing.

## Shape

```text
colors:
  light:   bg, surface, text, muted, primary, onPrimary, accent, onAccent,
           border, focus, danger, success
  dark:    the same roles
typography:
  body:    { name, faces: [{ src, weight, style }], fallback }
  heading: { name, faces: [{ src, weight, style }], fallback }
  scale:   xs, sm, base, lg, xl, 2xl, 3xl, 4xl
  weights: body, heading, strong
  lineHeights: body, heading
spacing:   xs, sm, md, lg, xl, 2xl
radius:    sm, md, lg
shadows:   sm, md, lg            (each a shadow or `none`)
buttonStyle:    square | rounded | pill
imageTreatment: rounded | framed | full-bleed
darkMode:       never | system
logo:           assets/logo.png  (optional)
```

Unknown keys are rejected at every level, in both schemas. A complete example is `exampleTheme`
in `fixtures.ts`.

## Overrides

A tenant `theme.yaml` sets only what it changes:

```yaml
colors:
  light:
    primary: '#0b5d1e'
typography:
  scale:
    base: 1.0625rem
buttonStyle: pill
logo: assets/logo.png
```

- Color roles, scale steps, weights, line heights, spacing, radius and shadow levels are merged
  **key by key**.
- A font family (`typography.body`, `typography.heading`) is **replaced as a whole**, because its
  files must match its name.
- `buttonStyle`, `imageTreatment`, `darkMode` and `logo` replace the base value.

## Color roles and intended pairings

Components use only the semantic roles, never a literal color. The pairs below are how the roles
are meant to be combined, as input for the contrast gate (#36), which decides the ratios:

| Foreground                     | Background      | Kind     |
| ------------------------------ | --------------- | -------- |
| `text`, `muted`                | `bg`, `surface` | text     |
| `onPrimary`                    | `primary`       | text     |
| `onAccent`                     | `accent`        | text     |
| `primary`, `danger`, `success` | `bg`, `surface` | text     |
| `focus`, `border`              | `bg`, `surface` | non-text |

`darkMode: never` keeps the site light; `system` follows the visitor's `prefers-color-scheme`. Both
schemes are always defined so a tenant can switch without adding colors. A visitor-facing toggle
would be a new `darkMode` value (an additive contract change).
