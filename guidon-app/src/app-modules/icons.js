/* ==== js/icons.js ==== */
/* GUIDON - icons.js : the inline SVG icon set (G.icons)

   Replaces the Unicode-dingbat era (◧ ◎ ⚑ ☎ ₵ ⌕ …), which rendered at the
   mercy of each device's font and read as placeholders. These are stroke
   icons on a 24x24 grid in the Feather idiom - consistent 2px stroke, round
   caps and joins - and they are theme-proof by construction: everything is
   drawn in `currentColor`, so an icon is always exactly as legible as the
   text beside it, in all 24 themes, with zero per-theme work.

   No network, no font, no sprite file: the geometry lives here and the build
   inlines it into every fork identically.

   G.icons.el(name, size?) -> <svg> element (aria-hidden - the OWNING control
   carries the accessible name, never the picture).
   G.icons.has(name) -> boolean.
*/
window.G = window.G || {};
(function () {
  "use strict";

  // Geometry idiom: p = path d, c = circle [cx,cy,r], l = line [x1,y1,x2,y2],
  // pl = polyline points, pg = polygon points, r = rect [x,y,w,h,rx].
  const D = {
    home: [{ p: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" }, { pl: "9 22 9 12 15 12 15 22" }],
    target: [{ c: [12, 12, 10] }, { c: [12, 12, 6] }, { c: [12, 12, 2] }],
    layers: [{ pg: "12 2 2 7 12 12 22 7" }, { pl: "2 17 12 22 22 17" }, { pl: "2 12 12 17 22 12" }],
    "graduation-cap": [{ p: "M22 10L12 5 2 10l10 5 10-5z" }, { p: "M6 12v5c3 3 9 3 12 0v-5" }, { l: [22, 10, 22, 16] }],
    "file-text": [{ p: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }, { pl: "14 2 14 8 20 8" }, { l: [16, 13, 8, 13] }, { l: [16, 17, 8, 17] }, { pl: "10 9 9 9 8 9" }],
    "message-circle": [{ p: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.5h.5a8.48 8.48 0 0 1 8 8z" }],
    "trending-up": [{ pl: "23 6 13.5 15.5 8.5 10.5 1 18" }, { pl: "17 6 23 6 23 12" }],
    shield: [{ p: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" }],
    award: [{ c: [12, 8, 7] }, { pl: "8.21 13.89 7 23 12 20 17 23 15.79 13.88" }],
    star: [{ pg: "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" }],
    crosshair: [{ c: [12, 12, 10] }, { l: [22, 12, 18, 12] }, { l: [6, 12, 2, 12] }, { l: [12, 6, 12, 2] }, { l: [12, 22, 12, 18] }],
    "share-2": [{ c: [18, 5, 3] }, { c: [6, 12, 3] }, { c: [18, 19, 3] }, { l: [8.59, 13.51, 15.42, 17.49] }, { l: [15.41, 6.51, 8.59, 10.49] }],
    briefcase: [{ r: [2, 7, 20, 14, 2] }, { p: "M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" }],
    pencil: [{ p: "M12 20h9" }, { p: "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" }],
    "dollar-sign": [{ l: [12, 1, 12, 23] }, { p: "M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" }],
    heart: [{ p: "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" }],
    activity: [{ pl: "22 12 18 12 15 21 9 3 6 12 2 12" }],
    send: [{ l: [22, 2, 11, 13] }, { pg: "22 2 15 22 11 13 2 9" }],
    compass: [{ c: [12, 12, 10] }, { pg: "16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88" }],
    book: [{ p: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20" }, { p: "M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" }],
    "book-open": [{ p: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" }, { p: "M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" }],
    "clipboard-check": [{ r: [8, 2, 8, 4, 1] }, { p: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" }, { pl: "9 14 11 16 15 12" }],
    calendar: [{ r: [3, 4, 18, 18, 2] }, { l: [16, 2, 16, 6] }, { l: [8, 2, 8, 6] }, { l: [3, 10, 21, 10] }],
    "bar-chart": [{ l: [12, 20, 12, 10] }, { l: [18, 20, 18, 4] }, { l: [6, 20, 6, 16] }],
    history: [{ p: "M3 3v5h5" }, { p: "M3.05 13A9 9 0 1 0 6 5.3L3 8" }, { pl: "12 7 12 12 15 15" }],
    "plus-square": [{ r: [3, 3, 18, 18, 2] }, { l: [12, 8, 12, 16] }, { l: [8, 12, 16, 12] }],
    sliders: [{ l: [4, 21, 4, 14] }, { l: [4, 10, 4, 3] }, { l: [12, 21, 12, 12] }, { l: [12, 8, 12, 3] }, { l: [20, 21, 20, 16] }, { l: [20, 12, 20, 3] }, { l: [1, 14, 7, 14] }, { l: [9, 8, 15, 8] }, { l: [17, 16, 23, 16] }],
    search: [{ c: [11, 11, 8] }, { l: [21, 21, 16.65, 16.65] }],
    user: [{ p: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" }, { c: [12, 7, 4] }],
    users: [{ p: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" }, { c: [9, 7, 4] }, { p: "M23 21v-2a4 4 0 0 0-3-3.87" }, { p: "M16 3.13a4 4 0 0 1 0 7.75" }],
    monitor: [{ r: [2, 3, 20, 14, 2] }, { l: [8, 21, 16, 21] }, { l: [12, 17, 12, 21] }],
    "check-circle": [{ p: "M22 11.08V12a10 10 0 1 1-5.93-9.14" }, { pl: "22 4 12 14.01 9 11.01" }],
    download: [{ p: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }, { pl: "7 10 12 15 17 10" }, { l: [12, 15, 12, 3] }],
    "alert-triangle": [{ p: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" }, { l: [12, 9, 12, 13] }, { l: [12, 17, 12.01, 17] }],
    phone: [{ p: "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" }],
    scale: [{ p: "m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" }, { p: "m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" }, { p: "M7 21h10" }, { p: "M12 3v18" }, { p: "M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" }],
    printer: [{ pl: "6 9 6 2 18 2 18 9" }, { p: "M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" }, { r: [6, 14, 12, 8] }],
    upload: [{ p: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }, { pl: "17 8 12 3 7 8" }, { l: [12, 3, 12, 15] }],
    x: [{ l: [18, 6, 6, 18] }, { l: [6, 6, 18, 18] }],
    play: [{ pg: "5 3 19 12 5 21" }],
    clock: [{ c: [12, 12, 10] }, { pl: "12 6 12 12 16 14" }],
    shuffle: [{ pl: "16 3 21 3 21 8" }, { l: [4, 20, 21, 3] }, { pl: "21 16 21 21 16 21" }, { l: [15, 15, 21, 21] }, { l: [4, 4, 9, 9] }],
    "chevron-left": [{ pl: "15 18 9 12 15 6" }],
    "chevron-right": [{ pl: "9 18 15 12 9 6" }],
    "chevron-down": [{ pl: "6 9 12 15 18 9" }],
    "rotate-ccw": [{ pl: "1 4 1 10 7 10" }, { p: "M3.51 15a9 9 0 1 0 2.13-9.36L1 10" }],
    "maximize-2": [{ pl: "15 3 21 3 21 9" }, { pl: "9 21 3 21 3 15" }, { l: [21, 3, 14, 10] }, { l: [3, 21, 10, 14] }],
    "minimize-2": [{ pl: "4 14 10 14 10 20" }, { pl: "20 10 14 10 14 4" }, { l: [14, 10, 21, 3] }, { l: [3, 21, 10, 14] }],
    check: [{ pl: "20 6 9 17 4 12" }],
    "life-buoy": [{ c: [12, 12, 10] }, { c: [12, 12, 4] }, { l: [4.93, 4.93, 9.17, 9.17] }, { l: [14.83, 14.83, 19.07, 19.07] }, { l: [14.83, 9.17, 19.07, 4.93] }, { l: [4.93, 19.07, 9.17, 14.83] }],
    map: [{ pg: "1 6 8 2 16 6 23 2 23 18 16 22 8 18 1 22" }, { l: [8, 2, 8, 18] }, { l: [16, 6, 16, 22] }],
  };

  const NS = "http://www.w3.org/2000/svg";

  function el(name, size) {
    const spec = D[name];
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size || 18));
    svg.setAttribute("height", String(size || 18));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("gi");
    if (!spec) return svg;                       // unknown name: empty box, visible in review
    for (const part of spec) {
      let node;
      if (part.p) { node = document.createElementNS(NS, "path"); node.setAttribute("d", part.p); }
      else if (part.c) { node = document.createElementNS(NS, "circle"); node.setAttribute("cx", part.c[0]); node.setAttribute("cy", part.c[1]); node.setAttribute("r", part.c[2]); }
      else if (part.l) { node = document.createElementNS(NS, "line"); node.setAttribute("x1", part.l[0]); node.setAttribute("y1", part.l[1]); node.setAttribute("x2", part.l[2]); node.setAttribute("y2", part.l[3]); }
      else if (part.pl) { node = document.createElementNS(NS, "polyline"); node.setAttribute("points", part.pl); }
      else if (part.pg) { node = document.createElementNS(NS, "polygon"); node.setAttribute("points", part.pg); }
      else if (part.r) { node = document.createElementNS(NS, "rect"); node.setAttribute("x", part.r[0]); node.setAttribute("y", part.r[1]); node.setAttribute("width", part.r[2]); node.setAttribute("height", part.r[3]); if (part.r[4]) node.setAttribute("rx", part.r[4]); }
      if (node) svg.appendChild(node);
    }
    return svg;
  }

  G.icons = { el, has: (n) => !!D[n], names: () => Object.keys(D) };

  // The app-wide accessor every call site goes through. Unknown name -> the
  // caller's text-glyph fallback: never a throw, never an empty box in the UI.
  G.util = G.util || {};
  G.util.icon = function (name, size, fallback) {
    if (D[name]) return el(name, size);
    const s = document.createElement("span");
    s.textContent = fallback || "\u2022";
    s.setAttribute("aria-hidden", "true");
    return s;
  };
})();
// END icons.js
