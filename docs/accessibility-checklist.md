# Accessibility Checklist

## Verified In Source

- Root language, page headings, named search, named media controls, focus rings, and reduced-motion
  styles exist.
- Genre/type/sort controls communicate pressed state.
- Images generally use meaningful alt text or empty alt text when decorative.
- Support fields are labeled and use native validation.
- Trailer and next-episode dialogs receive focus, and the trailer restores focus on close.
- Global player shortcuts do not override focused links, buttons, inputs, textareas, or selects.

## Audit Actions

- Replace the incomplete custom `SelectMenu` behavior with native select semantics.
- Ensure admin and download selectors have explicit accessible names.
- Keep accessible names on the icon-only mobile Movies/Series controls.
- Make download preparation and folder errors visible without `alert`.
- Remove misleading interactive controls.

## Remaining Before Launch

- Keyboard-test every route and all video controls.
- Verify color contrast at the app's unusually small text sizes.
- Test screen-reader announcements for errors, ticket success, download progress, and playback state.
- Test browser zoom, 320px width, tablet, desktop, and reduced motion.
- Ensure all primary touch targets are at least 40-44px where layout permits.
