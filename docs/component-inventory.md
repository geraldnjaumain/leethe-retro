# Component Inventory

## Implemented Shared Components

| Component           | Purpose                                    | States And Accessibility                                 | Mobile                                     |
| ------------------- | ------------------------------------------ | -------------------------------------------------------- | ------------------------------------------ |
| `Nav`               | Catalog navigation, type, sort, and search | Pressed state, labeled search, keyboard completion       | Wraps search and keeps touch targets large |
| `BrandMark`         | Brand mark                                 | Decorative and hidden from assistive tech                | Compact rounded-square app mark            |
| `PersonPlaceholder` | Missing cast portrait                      | Decorative; actor name remains adjacent                  | Circular crop-safe silhouette              |
| `MediaPlaceholder`  | Missing poster or player artwork           | Visible fallback label                                   | Poster and compact player variants         |
| `GenreRail`         | Genre filtering                            | Pressed state, live selected label, keyboard focus       | Horizontal touch scroll                    |
| `PosterCard`        | Catalog title link                         | Named link, focus ring, image fallback, skeleton peer    | Responsive grid                            |
| `SelectMenu`        | Shared stream/admin/download selector      | Must use native select semantics and an accessible name  | Full-width where constrained               |
| `AluminumPanel`     | Root error/not-found wrapper               | Heading, message, recovery actions                       | Centered card                              |
| `PlayerPlaceholder` | Playback loading/error display             | Direct status text                                       | Aspect-ratio stable                        |
| `VideoPlayer`       | Media playback controls                    | Named controls, safe keyboard shortcuts, persisted speed | Compact controls                           |

## Page-Local Components

Title rails, season lists, trailer dialog, watch top bar, stream controls, download menu, admin metric
cards/charts/status, and legal sections are page-local because they currently have one owner.

## Missing Or Deferred Shared Primitives

The app does not need every generic dashboard primitive from the original brief today. Dialog,
toast, error state, loading state, button, and icon-button primitives should be extracted when a
second use or behavioral divergence appears. The trailer dialog now traps and restores focus; it
should become the shared dialog primitive when another modal is introduced.

## Forbidden Usage

- One-off fake success actions.
- Unnamed selects or buttons.
- Hand-rolled listbox behavior without full keyboard/focus semantics.
- Decorative icon boxes that do not communicate interaction or state.
