/**
 * Single source of truth for which icon files GUIDON ships, and at what
 * size/treatment. Both tools/make-icons.mjs (which renders them) and
 * tools/build.mjs (which needs their filenames — to link them from the
 * platform <link> tags/manifest.webmanifest AND to precache them in sw.js)
 * import this array instead of each hand-typing its own copy of the file
 * list.
 *
 * That "each hand-typing its own copy" shape is exactly the bug this file
 * exists to close (GUIDON roadmap Tier 2, "single-source the service
 * worker's PRECACHE list"): icon-48.png shipped and was linked from
 * build.mjs's own <link rel="icon" sizes="48x48"> tag, but src/sw.js's
 * separately hand-typed PRECACHE array had never been updated to include
 * it, so it loaded over the network on first boot instead of being
 * available offline immediately. Add or rename an icon here, once, and
 * every consumer (rendering, linking, precaching) picks it up on the next
 * `npm run icons` / `npm run build`.
 *
 * `kind` only matters to make-icons.mjs (selects which of its three SVG
 * treatments to render — see that file's header comment: any/maskable/
 * apple). build.mjs only reads `file`.
 */
export const ICON_TARGETS = [
  { file: "icon-192.png", size: 192, kind: "any" },
  { file: "icon-512.png", size: 512, kind: "any" },
  { file: "icon-maskable-192.png", size: 192, kind: "maskable" },
  { file: "icon-maskable-512.png", size: 512, kind: "maskable" },
  { file: "apple-touch-icon.png", size: 180, kind: "apple" },
  { file: "icon-48.png", size: 48, kind: "any" },
];
