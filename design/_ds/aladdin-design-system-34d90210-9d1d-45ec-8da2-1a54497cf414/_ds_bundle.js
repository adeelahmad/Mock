/* @ds-bundle: {"format":4,"namespace":"AladdinDesignSystem_34d902","components":[{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"PhaseDot","sourcePath":"components/core/PhaseDot.jsx"},{"name":"Signature","sourcePath":"components/core/PhaseDot.jsx"},{"name":"Dialog","sourcePath":"components/feedback/Dialog.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Switch","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"AgentChip","sourcePath":"components/loop/AgentChip.jsx"},{"name":"GateVerdict","sourcePath":"components/loop/GateVerdict.jsx"},{"name":"LoopStepper","sourcePath":"components/loop/LoopStepper.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"},{"name":"ArtifactList","sourcePath":"components/surfaces/ArtifactList.jsx"},{"name":"Panel","sourcePath":"components/surfaces/Panel.jsx"},{"name":"Terminal","sourcePath":"components/surfaces/Terminal.jsx"}],"sourceHashes":{"assets/social/doc-page.js":"f52ae9c02fca","components/core/Badge.jsx":"1c8823a7c487","components/core/Button.jsx":"b8e04dd1ff94","components/core/IconButton.jsx":"ec15a6c7032e","components/core/PhaseDot.jsx":"588726640f2c","components/feedback/Dialog.jsx":"b7c14820c1de","components/feedback/Toast.jsx":"f77eadda353a","components/forms/Checkbox.jsx":"770aba01b244","components/forms/Input.jsx":"245e1bc64ab1","components/forms/Select.jsx":"be0913c27ed0","components/loop/AgentChip.jsx":"55e559279373","components/loop/GateVerdict.jsx":"d39945bd9a50","components/loop/LoopStepper.jsx":"06bc61616041","components/navigation/Tabs.jsx":"536a292d0071","components/surfaces/ArtifactList.jsx":"fedb53035a60","components/surfaces/Panel.jsx":"2797459e1e8a","components/surfaces/Terminal.jsx":"ba9f77cbb154","ui_kits/aloop/Screens.jsx":"551048280de8"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.AladdinDesignSystem_34d902 = window.AladdinDesignSystem_34d902 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// assets/social/doc-page.js
try { (() => {
// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)
// Copied omelette starter. Re-running copy_starter_component with this kind overwrites this file with the latest version (page content is unaffected).
/* BEGIN USAGE */
/**
 * <doc-page> — paged-document shell for printable HTML.
 *
 * FIRST, decide how the document paginates — up front, before building:
 *
 * - FLOWING document (the default): write the whole document as one
 *   normal HTML flow inside <doc-page>; the browser's print engine
 *   splits it onto pages at export. Use for long-form documents with a
 *   single text flow: reports, memos, letters, essays.
 * - EXPLICIT pagination: a fixed set of pre-paginated pages, one
 *   <section class="page"> child per page. Use when the user asks for a
 *   specific page count, or the design implies one: a one-page resume, a
 *   two-sided flier, a poster, a certificate, a brochure — any richly
 *   laid-out document without a single text flow.
 * - If in doubt, ask the user as part of the build.
 *
 * PAGE SIZING — paper differs by country (letter vs A4), so the printed
 * sheet is not one fixed truth:
 * - FLOWING documents pin NO paper size: the print engine paginates
 *   onto the user's real paper, and the content reflows to it.
 * - EXPLICITLY PAGINATED documents print each page at a FIXED page box
 *   with overflow hidden — letter by default, size="a4" for a clearly
 *   metric user, the user's chosen paper when they export. Design each
 *   page to FILL that box, fitting letter and A4 alike without overlap.
 * - width/height pin an explicit fixed size, ONLY when the user gives
 *   one.
 * Never write your own @page rule or hard-code paper dimensions in the
 * content.
 *
 * Sizing modes (attributes):
 *   (none)                      — portrait: flowing docs use the user's
 *           paper; explicitly paginated pages use the named size box
 *           (letter unless size="a4")
 *   orientation="landscape"     — the same, landscape
 *   width / height              — explicit fixed size, ONLY when the user
 *           gives one (e.g. width="22in" height="30in" for a 22×30
 *           poster): the page IS the design's size, printed at true
 *           dimensions (or scaled onto the user's paper at print time).
 *           Any absolute CSS length: px/in/mm/cm/pt/pc.
 * The component announces the chosen mode to the host app at runtime (a
 * meta tag it injects), so the print path can inject the user's true
 * paper size.
 *
 * On screen the document renders on a desk background: a flowing
 * document as one tall scrolling sheet (Google Docs' pageless view);
 * explicitly paginated documents as one card per page.
 *
 * EXPLICIT pagination usage:
 *   <style>doc-page:not(:defined){visibility:hidden}</style>
 *   <doc-page>
 *     <section class="page" id="p1">…one page's design…</section>
 *     <section class="page" id="p2">…</section>
 *   </doc-page>
 *   <script src="doc-page.js"></script>
 * How the page box works, concretely: each .page prints as ONE full-bleed
 * sheet at a FIXED physical size — letter by default (set size="a4" for
 * a clearly metric user), the user's chosen paper when they export —
 * with overflow hidden. Nothing scrolls and nothing reflows onto a next
 * sheet: content that misses the box is CLIPPED. Design each page to
 * FILL that page box, and to fit it — letter and A4 alike — without
 * overlap. Each page is a size container; don't size anything in
 * viewport units (they track the window, not the page), and never set
 * width or height on the .page section itself (the component sizes the
 * page box; an authored height like 100% is meaningless at print and is
 * overridden). The component owns the page box, the screen card chrome,
 * and the page breaks (never add your own break-before/after). Don't mix
 * .page sections with flowing content or header/footer slots in the same
 * document.
 *
 * FLOWING usage:
 *   <style>doc-page:not(:defined){visibility:hidden}</style>
 *   <doc-page margin="0.75in">
 *     <h1>Title</h1>
 *     <p>…body…</p>
 *   </doc-page>
 *   <script src="doc-page.js"></script>
 * There is no manual page-splitting — the browser's print engine
 * paginates at export. Standard break-hygiene rules (`break-inside:
 * avoid` on figures, code blocks, images and table rows; `orphans/
 * widows: 3`) are applied so paragraphs and groups split cleanly. On
 * screen and at print, headings default to `text-wrap: balance` and
 * body text to `text-wrap: pretty`; the defaults have zero specificity,
 * so any text-wrap you declare wins.
 *
 * Other attributes:
 *   size    — letter | a4 | legal (default letter). Flowing documents:
 *           preview proportion only — it does NOT pin their printed
 *           paper (the print dialog's paper governs); leave it alone
 *           there. Explicitly paginated documents: it sets the page box
 *           the cards and the pinned @page share (the export dialog's
 *           choice overrides both at print) — set size="a4" for a
 *           clearly metric user. Scaled-fit: names the sheet the fit is
 *           computed against, same a4-for-metric-users advice.
 *   content-width / content-height — the design's own fixed dimensions
 *           (CSS lengths), for scaling a fixed-size design ONTO the
 *           named sheet: content lays out at exactly this size, and the
 *           component scales it to fit that sheet's printable area
 *           (centered horizontally, top-aligned; the export dialog
 *           re-fits to the user's actual paper choice where available).
 *           Both must be set; they do not change the page box. For pages
 *           WITHOUT running header/footer slots.
 *   margin  — printable inset on every page of a FLOWING document
 *           (default 0.75in); margin="0" makes pages full-bleed.
 *           Explicitly paginated pages are always full-bleed.
 *
 * Running header/footer (flowing documents only): give an element
 * `slot="header"` or `slot="footer"` and it repeats on every printed
 * page via `position: fixed`. To keep body text from sliding under it,
 * the component prints inside a single-cell table whose <thead>/<tfoot>
 * are spacers sized to the header/footer height — browsers repeat
 * thead/tfoot on every page, so each sheet's content starts below the
 * header and ends above the footer. On screen the header/footer render
 * once at the top/bottom of the sheet.
 *
 * At print the component injects `@page { margin: 0 }` (which leaves
 * Chrome no margin box to draw its date/URL/page-count header in) and
 * moves the visual margin onto the sheet's own padding. It also marks
 * the document as owning its print CSS (a
 * `meta[name="omelette-owns-print"]` it injects at runtime), so the
 * PDF export never injects page-geometry CSS of its own on top.
 *
 * Print best practices for the content you author:
 * - Multi-column text: use CSS columns (`column-count` +
 *   `column-gap`), never side-by-side flex/grid columns — only real
 *   CSS columns flow and break across pages. `column-span: all` lets
 *   a heading span the columns; `hyphens: auto` (needs `lang` on
 *   the html element) keeps narrow columns readable.
 * - Page breaks in flowing documents: `break-before: page` on an
 *   element that must start a new page (a chapter, an appendix). Add
 *   your own kept-together blocks (callouts, stat tiles, cards) to a
 *   `break-inside: avoid` rule, and keep each one shorter than a page.
 * - Extend `orphans: 3; widows: 3` to any custom text blocks you add
 *   (p and li are covered by default).
 * - Give long tables a <thead> — browsers repeat it on every printed
 *   page.
 * - No `position: fixed`/`sticky` and no viewport units in content:
 *   fixed elements stamp every printed page (running headers/footers go
 *   in the component's slots) and `100vh` mis-sizes at print.
 *
 * Author content as static HTML so the user can click-to-edit any text
 * directly. Do not set width/padding/background on the document body —
 * the component owns the sheet box.
 */
/* END USAGE */

(() => {
  const PAPER = {
    letter: ['8.5in', '11in'],
    a4: ['210mm', '297mm'],
    legal: ['8.5in', '14in']
  };
  const CSS_LENGTH = /^\d+(\.\d+)?(px|in|mm|cm|pt|pc)$/;
  // Unitless "0" is a valid CSS length and the natural way to write
  // margin="0"; normalise it to 0px so max()/calc() (which reject a bare
  // number) keep working.
  const safeLen = (v, fb) => {
    v = (v || '').trim();
    return v === '0' ? '0px' : CSS_LENGTH.test(v) ? v : fb;
  };
  // WebKit (Safari and every iOS browser shell) never repeats a table's
  // thead/tfoot on printed pages (WebKit bug 17205), so the spacer-borne
  // vertical margins of a FLOWING document reach only the first page
  // there. Engine check, not browser check: vendor is 'Apple Computer,
  // Inc.' exactly for WebKit and 'Google Inc.' for Blink.
  const WK_PRINT = /apple/i.test(navigator.vendor || '');
  // CSS length → px number (CSS absolute units are exact: 1in = 96px).
  // Returns NaN for anything safeLen would reject — callers gate on it.
  const PX_PER = {
    px: 1,
    in: 96,
    mm: 96 / 25.4,
    cm: 96 / 2.54,
    pt: 96 / 72,
    pc: 16
  };
  const toPx = v => {
    const m = /^(\d+(?:\.\d+)?)(px|in|mm|cm|pt|pc)$/.exec((v || '').trim());
    return m ? parseFloat(m[1]) * PX_PER[m[2]] : NaN;
  };
  const stylesheet = `
    :host {
      position: relative;
      display: block;
      /* When the viewport is narrower than the page, grow to wrap the
       * sheet (plus this padding) instead of staying viewport-width, so
       * the desk background and right margin reach the sheet's far edge
       * in the horizontal scroll. */
      min-width: max-content;
      min-height: 100vh;
      background: #f5f5f4;
      padding: 48px 24px;
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
      --doc-page-w: 8.5in;
      --doc-page-h: 11in;
      --doc-page-margin: 0.75in;
      --doc-hdr-h: 0px;
      --doc-ftr-h: 0px;
      --doc-hdr-pad: 0px;
      --doc-ftr-pad: 0px;
    }
    .sheet {
      width: var(--doc-page-w);
      margin: 0 auto;
      background: #fff;
      box-shadow: 0 2px 10px rgba(20, 20, 19, 0.12);
      border-radius: 7px;
      box-sizing: border-box;
      padding: var(--doc-page-margin);
    }
    .frame { width: 100%; border-collapse: collapse; }
    /* Scaled-fit mode (content-width/content-height): the inner .fit box
     * lays the content out at its authored fixed size and scales it onto
     * the printable area; .fit-box reserves the scaled footprint in flow
     * (transforms don't affect layout) and centers it. Without the mode,
     * both divs are unstyled block pass-throughs. */
    /* Explicit pagination: direct .page children are the pages. The sheet
     * becomes a transparent stack and each page carries the card look on
     * screen; at print each page is exactly one full-bleed sheet. The
     * ::slotted defaults are deliberately weak (document CSS wins), so
     * authored page styling can override any of this. */
    .sheet.paginated {
      background: transparent;
      box-shadow: none;
      border-radius: 0;
      padding: 0;
    }
    .paginated ::slotted(.page) {
      position: relative;
      display: block;
      width: 100%;
      aspect-ratio: var(--doc-page-ar);
      container-type: size;
      overflow: hidden;
      box-sizing: border-box;
      background: #fff;
      border-radius: 7px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
      break-inside: avoid;
    }
    .paginated ::slotted(.page:not(:first-child)) { margin-top: 1rem; }
    @media print {
      .sheet.paginated { padding: 0; }
      /* The flowing-document vertical inset lives on the repeating
       * thead/tfoot spacers, not the sheet padding — they must go too,
       * or each full-sheet .page is pushed ~margin down and spills onto
       * a second sheet. Paginated pages are full-bleed by definition
       * (content owns its insets). */
      .sheet.paginated .hdr-space,
      .sheet.paginated .ftr-space { height: 0; }
      .paginated ::slotted(.page) {
        border-radius: 0 !important;
        box-shadow: none !important;
        margin: 0 !important;
        /* Physical page-box sizing, no viewport units: Safari resolves
         * 100vh against the window, not the page box, so a vh-sized card
         * paginates wrong there. --doc-page-w/h are the named size by
         * default and are overridden to the user's chosen paper by the
         * export path, so every card is exactly one sheet either way.
         * Width + height (same source values as @page size) rather than
         * width + aspect-ratio: the ratio is a 6-decimal rounding of the
         * same division, and a few millionths of overflow would spill a
         * blank sheet after every page. The screen-only aspect-ratio
         * (preview proportions) must not leak into print. cqh typography
         * tracks the same box.
         *
         * Every declaration is !important: per CSS Scoping, unimportant
         * shadow ::slotted rules LOSE to the document context, so a page
         * section's authored inline style would silently beat this print
         * geometry. A model-authored height:100% did exactly that — the
         * percentage resolves as auto in the all-auto print ancestry, the
         * base rule's size containment turns auto into ZERO, and
         * overflow:hidden then paints nothing: a blank PDF with perfect
         * page boxes. At print the component's geometry is the design's
         * whole contract, so it must win over any authored sizing. */
        aspect-ratio: auto !important;
        width: var(--doc-page-w) !important;
        height: var(--doc-page-h) !important;
        overflow: hidden !important;
      }
      .paginated ::slotted(.page:not(:first-child)) {
        break-before: page !important;
        margin-top: 0 !important;
      }
    }
    .fit-mode .fit-box {
      width: calc(var(--doc-fit-w) * var(--doc-fit-scale));
      height: calc(var(--doc-fit-h) * var(--doc-fit-scale));
      margin: 0 auto;
      break-inside: avoid;
    }
    /* Monolithic at print: Blink slices a transform-scaled child at
     * fragmentainer boundaries mapped in UNSCALED layout coordinates
     * (transforms are paint-time), so the .fit box (authored size, e.g.
     * 1400x990) gets cut at the page's free block space and spills onto
     * a second sheet even though its SCALED footprint fits the page by
     * construction. overflow:hidden makes .fit-box a scroll container —
     * monolithic under fragmentation (css-break-3) — so the scaled
     * content prints atomically on one sheet. No clipping for content
     * within the authored box: .fit-box is calc-sized to exactly the
     * scaled footprint. (Content that bleeds past content-width/height
     * is clipped at the footprint — fit mode's contract; it previously
     * painted beyond it at print.) Print-only, so the screen rendering
     * keeps visible overflow for editor affordances.
     * The export path injects the same rule into frozen copies
     * (print-eval.ts om-print-fit-contain). The .fit-mode scope is
     * load-bearing: .fit-box wraps slotted content in EVERY mode, and an
     * unscoped overflow:hidden would make whole flowing documents
     * monolithic (one truncated sheet). overflow:hidden, never clip —
     * clip is not a scroll container, so not monolithic. */
    @media print {
      .fit-mode .fit-box { overflow: hidden; }
    }
    .fit-mode .fit {
      width: var(--doc-fit-w);
      height: var(--doc-fit-h);
      transform: scale(var(--doc-fit-scale));
      transform-origin: top left;
    }
    .frame td, .frame th { padding: 0; text-align: left; font-weight: inherit; }
    .hdr-space { height: var(--doc-hdr-h); }
    .ftr-space { height: var(--doc-ftr-h); }
    ::slotted([slot="header"]),
    ::slotted([slot="footer"]) { display: block; box-sizing: border-box; }
    @media print {
      :host { background: none; padding: 0; min-width: 0; min-height: 0; }
      .sheet {
        width: auto; margin: 0; box-shadow: none; border-radius: 0;
        padding: 0 var(--doc-page-margin);
      }
      /* The thead/tfoot spacers repeat on every page, so they carry the
       * vertical page margin (which the sheet's own padding cannot, since
       * that padding is consumed once on the first/last page). The running
       * header/footer are fixed inside that band. */
      /* The 0.35in is breathing room between a running header/footer and
       * the body; without one the spacer is exactly the page margin, so a
       * margin="0" full-bleed document gets truly full-bleed pages. */
      .hdr-space { height: max(var(--doc-page-margin), calc(var(--doc-hdr-h) + var(--doc-hdr-pad))); }
      .ftr-space { height: max(var(--doc-page-margin), calc(var(--doc-ftr-h) + var(--doc-ftr-pad))); }
      /* WebKit flowing documents: @page carries the vertical margin (see
       * _syncPrintPageRule), so the spacers keep only whatever a running
       * header/footer needs BEYOND it — page 1 would otherwise double its
       * top inset. Paginated sheets already zero their spacers above. */
      .sheet.wk-print:not(.paginated) .hdr-space { height: max(0px, calc(max(var(--doc-page-margin), calc(var(--doc-hdr-h) + var(--doc-hdr-pad))) - var(--doc-page-margin))); }
      .sheet.wk-print:not(.paginated) .ftr-space { height: max(0px, calc(max(var(--doc-page-margin), calc(var(--doc-ftr-h) + var(--doc-ftr-pad))) - var(--doc-page-margin))); }
      ::slotted([slot="header"]) {
        position: fixed; top: 0; left: 0; right: 0; margin: 0;
        padding: calc(var(--doc-page-margin) * 0.45) var(--doc-page-margin) 0;
      }
      ::slotted([slot="footer"]) {
        position: fixed; bottom: 0; left: 0; right: 0; margin: 0;
        padding: 0 var(--doc-page-margin) calc(var(--doc-page-margin) * 0.45);
      }
    }
  `;
  class DocPage extends HTMLElement {
    static get observedAttributes() {
      return ['size', 'width', 'height', 'margin', 'orientation', 'content-width', 'content-height'];
    }
    constructor() {
      super();
      this._root = this.attachShadow({
        mode: 'open'
      });
      this._mo = typeof MutationObserver === 'function' ? new MutationObserver(() => this._scheduleMeasure()) : null;
    }

    /** The named paper's [w, h], swapped when orientation="landscape".
     *  Only the named size swaps — explicit width/height are exact values
     *  the author already oriented. */
    _paperSize() {
      const named = PAPER[(this.getAttribute('size') || '').toLowerCase()] || PAPER.letter;
      const landscape = (this.getAttribute('orientation') || '').trim().toLowerCase() === 'landscape';
      return landscape ? [named[1], named[0]] : named;
    }
    get pageWidth() {
      return safeLen(this.getAttribute('width'), this._paperSize()[0]);
    }
    get pageHeight() {
      return safeLen(this.getAttribute('height'), this._paperSize()[1]);
    }
    get pageMargin() {
      return safeLen(this.getAttribute('margin'), '0.75in');
    }

    /** Scaled-fit mode's content box [w, h] as CSS lengths, or null when
     *  the mode is off (either attribute missing/invalid/zero — a partial
     *  declaration falls back to normal flow rather than guessing). */
    _contentFit() {
      const w = safeLen(this.getAttribute('content-width'), null);
      const h = safeLen(this.getAttribute('content-height'), null);
      if (!w || !h) return null;
      const wPx = toPx(w),
        hPx = toPx(h);
      return wPx > 0 && hPx > 0 ? [w, h, wPx, hPx] : null;
    }
    connectedCallback() {
      if (!this._sheet) this._render();
      this._syncSize();
      this._syncPrintPageRule();
      this._ensureTextWrapDefaults();
      this._ensureOwnsPrintMeta();
      this._syncFixedSizeMeta();
      this._syncPrintSizingMeta();
      if (this._mo) this._mo.observe(this, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true
      });
      this._onResize = () => this._scheduleMeasure();
      window.addEventListener('resize', this._onResize);
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => this._scheduleMeasure());
      }
      this._scheduleMeasure();
    }
    disconnectedCallback() {
      window.removeEventListener('resize', this._onResize);
      if (this._mo) this._mo.disconnect();
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = null;
      }
      // Drop the head rules when the last doc-page leaves, so a deleted
      // document's @page geometry and text-wrap defaults can't apply to
      // whatever replaces it.
      const survivor = document.querySelector('doc-page');
      if (!survivor) {
        ['doc-page-print', 'doc-page-text-wrap', 'doc-page-owns-print', 'doc-page-fixed-size', 'doc-page-print-sizing'].forEach(id => {
          const tag = document.getElementById(id);
          if (tag) tag.remove();
        });
        // A live deck-stage deferred its own print-sizing meta to ours —
        // hand the page-global meta over so the deck isn't left unmarked.
        const deck = document.querySelector('deck-stage');
        if (deck && typeof deck._ensurePrintSizingMeta === 'function') {
          deck._ensurePrintSizingMeta();
        }
      } else {
        // A departed owner hands each page-global meta to whatever
        // doc-page remains (or it's removed).
        if (typeof survivor._syncFixedSizeMeta === 'function') {
          survivor._syncFixedSizeMeta();
        }
        if (typeof survivor._syncPrintSizingMeta === 'function') {
          survivor._syncPrintSizingMeta();
        }
      }
    }
    attributeChangedCallback() {
      if (!this._sheet) return;
      this._syncSize();
      this._syncPrintPageRule();
      this._syncFixedSizeMeta();
      this._syncPrintSizingMeta();
      this._scheduleMeasure();
    }
    _render() {
      this._root.innerHTML = `
        <style>${stylesheet}</style>
        <style id="vars"></style>
        <div class="sheet" data-screen-label="Document">
          <table class="frame" role="presentation">
            <thead><tr><th><div class="hdr-space"><slot name="header"></slot></div></th></tr></thead>
            <tbody><tr><td class="body"><div class="fit-box"><div class="fit"><slot></slot></div></div></td></tr></tbody>
            <tfoot><tr><td><div class="ftr-space"><slot name="footer"></slot></div></td></tr></tfoot>
          </table>
        </div>`;
      this._sheet = this._root.querySelector('.sheet');
      this._vars = this._root.getElementById('vars');
    }

    /** Runtime sizing lives in a shadow <style> :host rule, never on the
     *  light-DOM host element, so serialize-persist can't write it back. */
    _syncSize(hdrH, ftrH) {
      // Scaled-fit mode: content at its authored size, scaled onto the
      // printable area (page minus margins on both axes). The factor is a
      // plain number var so calc(length * number) stays valid; 4 decimals
      // keeps the shadow style stable across re-measures. Upscaling is
      // allowed — print transforms are vector, so text and CSS stay crisp
      // (raster images soften, which the catalog bullet warns about).
      const fit = this._contentFit();
      let fitVars = '';
      if (fit) {
        const marginPx = toPx(this.pageMargin) || 0;
        const availW = toPx(this.pageWidth) - 2 * marginPx;
        const availH = toPx(this.pageHeight) - 2 * marginPx;
        const scale = Math.min(availW / fit[2], availH / fit[3]);
        if (scale > 0 && Number.isFinite(scale)) {
          fitVars = '--doc-fit-w:' + fit[0] + ';' + '--doc-fit-h:' + fit[1] + ';' + '--doc-fit-scale:' + scale.toFixed(4) + ';';
        }
      }
      this._sheet.classList.toggle('fit-mode', !!fitVars);
      // Numeric w/h ratio for the paginated page cards' aspect-ratio —
      // aspect-ratio takes a number, not a length ratio, so compute it
      // here (CSS length division isn't portable). 6 decimals keeps the
      // shadow style stable across re-syncs.
      const arW = toPx(this.pageWidth);
      const arH = toPx(this.pageHeight);
      const ar = arW > 0 && arH > 0 ? (arW / arH).toFixed(6) : '0.772727';
      this._vars.textContent = ':host{' + fitVars + '--doc-page-ar:' + ar + ';' + '--doc-page-w:' + this.pageWidth + ';' + '--doc-page-h:' + this.pageHeight + ';' + '--doc-page-margin:' + this.pageMargin + ';' + '--doc-hdr-h:' + (hdrH || 0) + 'px;' + '--doc-ftr-h:' + (ftrH || 0) + 'px;' + '--doc-hdr-pad:' + (hdrH ? '0.35in' : '0px') + ';' + '--doc-ftr-pad:' + (ftrH ? '0.35in' : '0px') + '}';
    }

    /** @page is a no-op inside shadow DOM, so the rule lives in <head>.
     *  Re-appended on every sync so it stays last in source order — the
     *  @page cascade is source-order per descriptor, so this rule wins
     *  over any other @page rule in the document.
     *
     *  The @page SIZE is pinned where the page box IS part of the design:
     *  explicit-fixed-size mode (width + height authored), scaled-fit
     *  mode (the named sheet the fit targets), and explicit pagination
     *  (the named size the cards share — so card and sheet agree on
     *  every print path, and the export path's chosen paper overrides
     *  BOTH with one later rule). For FLOWING documents no paper size is
     *  emitted at all — the true size comes from the user's preference,
     *  injected by the export path or chosen in the print dialog — so a
     *  flowing document never fights the paper it lands on.
     *  margin: 0 is emitted in every mode: it leaves Chrome no margin box
     *  to draw its date/URL/page-count header in, and the visual margin
     *  lives on the sheet's own padding. */
    _syncPrintPageRule() {
      const id = 'doc-page-print';
      let tag = document.getElementById(id);
      if (!tag) {
        tag = document.createElement('style');
        tag.id = id;
      }
      document.head.appendChild(tag);
      // Three print-geometry regimes:
      // - true-size: the page IS the design — pin its exact size.
      // - scaled-fit (content-width/height): the fit factor is computed
      //   against the NAMED paper's printable area, so that paper must
      //   stay pinned or the scaled content overflows a smaller sheet
      //   (the export path re-fits and re-pins at print time on top).
      // - default modes: no paper size — but landscape still needs the
      //   paper-agnostic 'size: landscape' keyword, because the size
      //   descriptor is what carries orientation; without it a landscape
      //   document prints portrait whenever nothing injects a size.
      const landscape = (this.getAttribute('orientation') || '').trim().toLowerCase() === 'landscape';
      // Explicit pagination pins the page box to the SAME values that
      // size the cards (the named size by default, the export path's
      // chosen paper when its later rule overrides both) — card and
      // sheet agree on every print path, and a mismatched real paper
      // shrinks-to-fit in the dialog instead of clipping a Letter card
      // on A4. Declared before the paginated read below so both derive
      // from one check.
      const paginatedNow = this.querySelector(':scope > .page') !== null;
      const sizeDescriptor = this._trueSizePx() ? 'size: ' + this.pageWidth + ' ' + this.pageHeight + '; ' : this._contentFit() ? 'size: ' + this.pageWidth + ' ' + this.pageHeight + '; ' : paginatedNow ? 'size: ' + this.pageWidth + ' ' + this.pageHeight + '; ' : landscape ? 'size: landscape; ' : '';
      // WebKit never repeats the thead/tfoot spacers that carry a flowing
      // document's vertical page margins (see WK_PRINT above), so pages
      // after the first print edge-to-edge there. Carry the VERTICAL
      // margins on @page for WebKit instead, and the shadow print CSS
      // trims the first-page spacers by the same amount (.sheet.wk-print
      // rules). Horizontal inset stays on the sheet's own padding in
      // every engine. Blink keeps margin: 0 (a nonzero margin there
      // re-opens the box Chrome draws its header furniture in). One cost,
      // learned in testing: Safari's own date/URL headers are a USER
      // dialog setting ("Print headers and footers") that renders in the
      // margin area when room exists — margin: 0 only suppressed it by
      // leaving no room, and no CSS controls it. The export dialog's
      // Safari guide teaches turning the setting off for flowing
      // documents. Explicitly paginated and fixed-size documents keep
      // margin: 0 everywhere: their pages ARE the sheet.
      const wkFlowing = WK_PRINT && !paginatedNow && !this._trueSizePx() && !this._contentFit();
      const marginDescriptor = wkFlowing ? 'margin: ' + this.pageMargin + ' 0; ' : 'margin: 0; ';
      // Shadow-internal marker (never serialized), kept in lockstep with
      // the @page decision above: the print CSS trims the first-page
      // spacers ONLY while @page actually carries the margins — a
      // true-size or scaled-fit sheet keeps margin: 0 and must keep its
      // spacers too. Re-synced here so attribute changes and pagination
      // flips move both together.
      if (this._sheet) this._sheet.classList.toggle('wk-print', wkFlowing);
      tag.textContent = '@page { ' + sizeDescriptor + marginDescriptor + '} ' + '@media print { html, body { margin: 0 !important; padding: 0 !important; background: none !important; height: auto !important; overflow: visible !important; } ' + 'h1,h2,h3,h4,h5,h6 { break-after: avoid; } ' + 'figure,pre,blockquote,img,svg,tr { break-inside: avoid; } ' + 'p,li { orphans: 3; widows: 3; } ' + '* { -webkit-print-color-adjust: exact; print-color-adjust: exact; ' + 'backdrop-filter: none !important; -webkit-backdrop-filter: none !important; } ' + '*, *::before, *::after { animation-delay: -99s !important; animation-duration: .001s !important; ' + 'animation-iteration-count: 1 !important; animation-fill-mode: both !important; ' + 'animation-play-state: running !important; transition-duration: 0s !important; } }';
    }

    /** Typographic defaults for document text: balance headings, avoid
     *  widowed/orphaned words in body copy (browsers without text-wrap
     *  support drop the declarations). Zero-specificity via :where() so
     *  any text-wrap authored on those elements wins; document-level so the
     *  rules reach the slotted (light DOM) content — shadow styles can't.
     *  data-omelette-injected marks the tag for the host editor to strip
     *  at serialize, so it is never written back as authored source. */
    _ensureTextWrapDefaults() {
      if (document.getElementById('doc-page-text-wrap')) return;
      const tag = document.createElement('style');
      tag.id = 'doc-page-text-wrap';
      tag.setAttribute('data-omelette-injected', '');
      tag.textContent = ':where(h1,h2,h3,h4,h5,h6){text-wrap:balance}' + ':where(p,li,blockquote,figcaption){text-wrap:pretty}';
      document.head.appendChild(tag);
    }

    /** Declares that this document owns its print CSS. The instant-PDF
     *  export checks for the meta by NAME PRESENCE alone (content is
     *  ignored) and skips its automatic print-CSS injections, so the
     *  component's @page geometry is never overridden by a heuristic.
     *  data-omelette-injected keeps it out of serialized source. */
    _ensureOwnsPrintMeta() {
      if (document.getElementById('doc-page-owns-print')) return;
      const tag = document.createElement('meta');
      tag.id = 'doc-page-owns-print';
      tag.name = 'omelette-owns-print';
      tag.content = 'true';
      tag.setAttribute('data-omelette-injected', '');
      document.head.appendChild(tag);
    }

    /** This page's valid true-size page box (explicit width AND height)
     *  as [w, h] px ints, or null when the mode is off. */
    _trueSizePx() {
      if (!safeLen(this.getAttribute('width'), null) || !safeLen(this.getAttribute('height'), null)) return null;
      const w = Math.round(toPx(this.pageWidth));
      const h = Math.round(toPx(this.pageHeight));
      return w > 0 && h > 0 ? [w, h] : null;
    }

    /** True-size pages (explicit width AND height) also declare the page
     *  box as the preview size: the in-app preview reads
     *  meta[name="omelette-fixed-size"] (content "W,H" in px ints) and
     *  scales the sheet into view — without it an 18in poster previews at
     *  true size with scrollbars. Never overrides an author-set meta
     *  (only the component's own id is managed). The meta is page-global
     *  while doc-page instances are not, so every sync recomputes the
     *  page-wide owner — the first connected true-size doc-page — and a
     *  non-true-size sibling's sync can never delete the owner's meta.
     *  Removed when no true-size page remains (the owner's disconnect
     *  re-syncs via any survivor) or when an author-set meta exists. */
    _syncFixedSizeMeta() {
      const id = 'doc-page-fixed-size';
      const own = document.getElementById(id);
      const authored = document.querySelector('meta[name="omelette-fixed-size"]:not([data-omelette-injected])');
      // The page-wide owner, not this instance: an upgraded true-size page
      // anywhere in the document keeps the meta alive and sized.
      let box = null;
      for (const el of document.querySelectorAll('doc-page')) {
        box = typeof el._trueSizePx === 'function' ? el._trueSizePx() : null;
        if (box) break;
      }
      if (!box || authored) {
        if (own) own.remove();
        return;
      }
      const tag = own || document.createElement('meta');
      tag.id = id;
      tag.name = 'omelette-fixed-size';
      tag.content = box[0] + ',' + box[1];
      tag.setAttribute('data-omelette-injected', '');
      if (!own) document.head.appendChild(tag);
    }

    /** This page's print-sizing mode: 'fixed' when an explicit width AND
     *  height are authored (the page is the design's own size), else the
     *  default paper in the authored orientation. */
    _printSizingMode() {
      if (this._trueSizePx()) return 'fixed';
      const landscape = (this.getAttribute('orientation') || '').trim().toLowerCase() === 'landscape';
      return landscape ? 'default-landscape' : 'default-portrait';
    }

    /** Announces the print-sizing mode to the host app:
     *  meta[name="omelette-print-sizing"] with content 'default-portrait',
     *  'default-landscape', or 'fixed' (fixed pages also carry the
     *  omelette-fixed-size meta with the page box in px). The export path
     *  probes it to decide what true paper size to inject at print time —
     *  in the default modes the component emits no paper size of its own.
     *  Same page-global ownership rules as the fixed-size meta above:
     *  first connected doc-page owns it, an authored meta is never
     *  overridden, removed when no doc-page remains. */
    _syncPrintSizingMeta() {
      const id = 'doc-page-print-sizing';
      const own = document.getElementById(id);
      const authored = document.querySelector('meta[name="omelette-print-sizing"]:not([data-omelette-injected])');
      // A fixed page wins outright (mirroring the fixed-size loop above,
      // so the two metas can never contradict each other in a mixed
      // multi-page document); otherwise the first page's mode holds.
      let mode = null;
      for (const el of document.querySelectorAll('doc-page')) {
        if (typeof el._printSizingMode !== 'function') continue;
        const m = el._printSizingMode();
        if (m === 'fixed') {
          mode = m;
          break;
        }
        if (mode === null) mode = m;
      }
      if (!mode || authored) {
        if (own) own.remove();
        return;
      }
      // A deck-stage that connected first injected its own meta and
      // defers to any existing one — take it over, or the document ends
      // up with two conflicting injected metas (a doc-page page is the
      // document; the deck re-ensures its meta if every doc-page leaves).
      const deckMeta = document.getElementById('deck-stage-print-sizing');
      if (deckMeta) deckMeta.remove();
      const tag = own || document.createElement('meta');
      tag.id = id;
      tag.name = 'omelette-print-sizing';
      tag.content = mode;
      tag.setAttribute('data-omelette-injected', '');
      if (!own) document.head.appendChild(tag);
    }
    _scheduleMeasure() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        this._measure();
      });
    }

    /** Slot heights feed the print spacers (--doc-hdr-h / --doc-ftr-h), so
     *  they re-measure on content mutation, resize, and font load. The
     *  same pass detects explicit pagination (direct .page children) and
     *  toggles the sheet between the flowing-document card and the
     *  page-per-card stack — content edits can add or remove pages at any
     *  time, so this tracks the same mutations the measurement does. */
    _measure() {
      const hdr = this.querySelector(':scope > [slot="header"]');
      const ftr = this.querySelector(':scope > [slot="footer"]');
      const wasPaginated = this._sheet.classList.contains('paginated');
      this._sheet.classList.toggle('paginated', this.querySelector(':scope > .page') !== null);
      // The WebKit @page margin is flowing-only, so a pagination flip
      // must re-emit the rule (content edits can add or remove .page
      // sections at any time).
      if (this._sheet.classList.contains('paginated') !== wasPaginated) {
        this._syncPrintPageRule();
      }
      this._syncSize(hdr ? hdr.offsetHeight : 0, ftr ? ftr.offsetHeight : 0);
    }
  }
  if (!customElements.get('doc-page')) {
    customElements.define('doc-page', DocPage);
  }
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "assets/social/doc-page.js", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
const TONES = {
  intent: {
    fg: 'var(--aladdin-blue)',
    bg: 'var(--intent-surface)',
    bd: 'var(--intent-border)',
    dk: 'var(--blue-dark)'
  },
  red: {
    fg: 'var(--aladdin-red)',
    bg: 'var(--red-surface)',
    bd: 'var(--red-border)',
    dk: 'var(--red-dark)'
  },
  green: {
    fg: 'var(--aladdin-green)',
    bg: 'var(--green-surface)',
    bd: 'var(--green-border)',
    dk: 'var(--green-dark)'
  },
  gate: {
    fg: 'var(--aladdin-gold)',
    bg: 'var(--gate-surface)',
    bd: 'var(--gate-border)',
    dk: 'var(--gold-dark)'
  },
  neutral: {
    fg: 'var(--text-muted)',
    bg: 'var(--surface-neutral)',
    bd: 'var(--border)',
    dk: 'var(--text-strong)'
  }
};
function Badge({
  tone = 'neutral',
  variant = 'soft',
  dot = false,
  mono = false,
  children,
  style
}) {
  const t = TONES[tone] || TONES.neutral;
  const solid = variant === 'solid';
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 22,
      padding: '0 9px',
      borderRadius: 'var(--radius-pill)',
      background: solid ? t.fg : t.bg,
      color: solid ? tone === 'gate' ? 'var(--text-primary)' : '#fff' : t.dk,
      border: solid ? 'none' : '1px solid ' + t.bd,
      font: mono ? '500 11px/1 var(--font-mono)' : '700 11px/1 var(--font-sans)',
      letterSpacing: mono ? 0 : '.04em',
      textTransform: mono ? 'none' : 'uppercase',
      whiteSpace: 'nowrap',
      ...style
    }
  }, dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: solid ? 'currentColor' : t.fg
    }
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  sm: {
    h: 32,
    px: 12,
    fs: 13
  },
  md: {
    h: 40,
    px: 16,
    fs: 14
  },
  lg: {
    h: 48,
    px: 22,
    fs: 16
  }
};
function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  icon = null,
  children,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [down, setDown] = React.useState(false);
  const s = SIZES[size] || SIZES.md;
  const V = {
    primary: {
      bg: hover ? 'var(--blue-dark)' : 'var(--aladdin-blue)',
      fg: '#fff',
      bd: 'transparent'
    },
    secondary: {
      bg: hover ? 'var(--intent-surface)' : 'var(--background)',
      fg: 'var(--aladdin-blue)',
      bd: 'var(--border)'
    },
    ghost: {
      bg: hover ? 'var(--surface-neutral)' : 'transparent',
      fg: 'var(--text-strong)',
      bd: 'transparent'
    },
    approve: {
      bg: hover ? 'var(--green-dark)' : 'var(--aladdin-green)',
      fg: '#fff',
      bd: 'transparent'
    },
    danger: {
      bg: hover ? 'var(--red-dark)' : 'var(--aladdin-red)',
      fg: '#fff',
      bd: 'transparent'
    }
  }[variant] || {};
  return /*#__PURE__*/React.createElement("button", _extends({
    disabled: disabled,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setDown(false);
    },
    onMouseDown: () => setDown(true),
    onMouseUp: () => setDown(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      height: s.h,
      padding: '0 ' + s.px + 'px',
      borderRadius: 'var(--radius-pill)',
      border: '1px solid ' + V.bd,
      background: disabled ? 'var(--surface-neutral)' : V.bg,
      color: disabled ? 'var(--text-muted)' : V.fg,
      font: '700 ' + s.fs + 'px/1 var(--font-sans)',
      letterSpacing: '.005em',
      cursor: disabled ? 'not-allowed' : 'pointer',
      transform: down && !disabled ? 'scale(.98)' : 'none',
      transition: 'background var(--dur-fast) var(--ease-standard),transform var(--dur-fast) var(--ease-standard)',
      whiteSpace: 'nowrap',
      ...style
    }
  }, rest), icon, children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function IconButton({
  label,
  size = 36,
  active = false,
  children,
  style,
  ...rest
}) {
  const [h, setH] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", _extends({
    "aria-label": label,
    title: label,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      width: size,
      height: size,
      display: 'inline-grid',
      placeItems: 'center',
      borderRadius: '50%',
      border: 'none',
      background: active ? 'var(--intent-surface)' : h ? 'var(--surface-neutral)' : 'transparent',
      color: active ? 'var(--aladdin-blue)' : 'var(--text-secondary)',
      cursor: 'pointer',
      transition: 'background var(--dur-fast) var(--ease-standard)',
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/PhaseDot.jsx
try { (() => {
const TONES = {
  intent: {
    fg: 'var(--aladdin-blue)',
    bg: 'var(--intent-surface)',
    bd: 'var(--intent-border)',
    dk: 'var(--blue-dark)'
  },
  red: {
    fg: 'var(--aladdin-red)',
    bg: 'var(--red-surface)',
    bd: 'var(--red-border)',
    dk: 'var(--red-dark)'
  },
  green: {
    fg: 'var(--aladdin-green)',
    bg: 'var(--green-surface)',
    bd: 'var(--green-border)',
    dk: 'var(--green-dark)'
  },
  gate: {
    fg: 'var(--aladdin-gold)',
    bg: 'var(--gate-surface)',
    bd: 'var(--gate-border)',
    dk: 'var(--gold-dark)'
  },
  neutral: {
    fg: 'var(--text-muted)',
    bg: 'var(--surface-neutral)',
    bd: 'var(--border)',
    dk: 'var(--text-strong)'
  }
};
function PhaseDot({
  tone = 'intent',
  size = 12,
  shape = 'dot',
  ring = false,
  style
}) {
  const t = TONES[tone] || TONES.intent;
  const base = {
    display: 'inline-block',
    width: size,
    height: size,
    background: t.fg,
    flex: 'none',
    boxShadow: ring ? '0 0 0 3px ' + t.bg : 'none',
    ...style
  };
  if (shape === 'diamond') return /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      ...base,
      transform: 'rotate(45deg)',
      borderRadius: 2,
      width: size * .8,
      height: size * .8
    }
  });
  return /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      ...base,
      borderRadius: '50%'
    }
  });
}
function Signature({
  size = 12,
  gap = 8
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      gap
    }
  }, ['intent', 'red', 'green', 'gate'].map(t => /*#__PURE__*/React.createElement(PhaseDot, {
    key: t,
    tone: t,
    size: size
  })));
}
Object.assign(__ds_scope, { PhaseDot, Signature });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/PhaseDot.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Dialog.jsx
try { (() => {
function Dialog({
  open = true,
  title,
  children,
  actions,
  onClose,
  inline = false,
  style
}) {
  if (!open) return null;
  const card = /*#__PURE__*/React.createElement("div", {
    role: "dialog",
    style: {
      width: '100%',
      maxWidth: 480,
      background: 'var(--background)',
      borderRadius: 'var(--radius-xl)',
      boxShadow: 'var(--shadow-3)',
      padding: 24,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      ...style
    }
  }, title && /*#__PURE__*/React.createElement("div", {
    style: {
      font: '700 22px/1.25 var(--font-sans)',
      color: 'var(--text-primary)',
      letterSpacing: '-.01em'
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '400 15px/1.55 var(--font-sans)',
      color: 'var(--text-secondary)'
    }
  }, children), actions && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 8
    }
  }, actions));
  if (inline) return card;
  return /*#__PURE__*/React.createElement("div", {
    onClick: e => e.target === e.currentTarget && onClose && onClose(),
    style: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(32,33,36,.32)',
      backdropFilter: 'blur(2px)',
      display: 'grid',
      placeItems: 'center',
      padding: 24,
      zIndex: 100
    }
  }, card);
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
const G = {
  intent: ['var(--aladdin-blue)', '●'],
  red: ['var(--aladdin-red)', '✕'],
  green: ['var(--aladdin-green)', '✓'],
  gate: ['var(--aladdin-gold)', '◆']
};
function Toast({
  tone = 'intent',
  title,
  children,
  action,
  style
}) {
  const [c, g] = G[tone] || G.intent;
  return /*#__PURE__*/React.createElement("div", {
    role: "status",
    style: {
      display: 'flex',
      gap: 12,
      alignItems: 'center',
      padding: '12px 16px',
      minWidth: 280,
      maxWidth: 440,
      background: 'var(--text-primary)',
      color: '#fff',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-3)',
      font: '400 14px/1.4 var(--font-sans)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: c,
      fontSize: 14,
      flex: 'none'
    }
  }, g), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, title && /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700
    }
  }, title), children && /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--term-muted)',
      fontSize: 13
    }
  }, children)), action && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--term-blue)',
      fontWeight: 700,
      cursor: 'pointer'
    }
  }, action));
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function Checkbox({
  checked = false,
  onChange,
  label,
  disabled = false,
  style
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? .5 : 1,
      font: '400 14px/1.3 var(--font-sans)',
      color: 'var(--text-primary)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: () => !disabled && onChange && onChange(!checked),
    style: {
      width: 18,
      height: 18,
      borderRadius: 4,
      border: checked ? 'none' : '2px solid var(--text-secondary)',
      background: checked ? 'var(--aladdin-blue)' : 'var(--background)',
      display: 'grid',
      placeItems: 'center',
      color: '#fff',
      font: '800 12px/1 var(--font-sans)',
      boxSizing: 'border-box',
      transition: 'background var(--dur-fast)'
    }
  }, checked ? '✓' : ''), label);
}
function Switch({
  checked = false,
  onChange,
  label,
  disabled = false,
  style
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? .5 : 1,
      font: '400 14px/1.3 var(--font-sans)',
      color: 'var(--text-primary)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: () => !disabled && onChange && onChange(!checked),
    style: {
      width: 36,
      height: 20,
      borderRadius: 10,
      background: checked ? 'var(--aladdin-blue)' : 'var(--border)',
      position: 'relative',
      transition: 'background var(--dur-base) var(--ease-standard)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: 2,
      left: checked ? 18 : 2,
      width: 16,
      height: 16,
      borderRadius: '50%',
      background: '#fff',
      boxShadow: 'var(--shadow-1)',
      transition: 'left var(--dur-base) var(--ease-standard)'
    }
  })), label);
}
Object.assign(__ds_scope, { Checkbox, Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Input({
  label,
  hint,
  error,
  mono = false,
  multiline = false,
  style,
  ...rest
}) {
  const [f, setF] = React.useState(false);
  const Tag = multiline ? 'textarea' : 'input';
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      font: '700 13px/1.2 var(--font-sans)',
      color: 'var(--text-strong)'
    }
  }, label), /*#__PURE__*/React.createElement(Tag, _extends({
    onFocus: () => setF(true),
    onBlur: () => setF(false),
    rows: multiline ? 3 : undefined,
    style: {
      minHeight: multiline ? 88 : 40,
      padding: multiline ? '10px 14px' : '0 14px',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid ' + (error ? 'var(--aladdin-red)' : f ? 'var(--aladdin-blue)' : 'var(--border)'),
      boxShadow: f ? '0 0 0 3px ' + (error ? 'var(--red-surface)' : 'var(--intent-surface)') : 'none',
      background: 'var(--background)',
      font: mono ? '400 14px/1.5 var(--font-mono)' : '400 15px/1.5 var(--font-sans)',
      color: 'var(--text-primary)',
      outline: 'none',
      resize: 'vertical',
      transition: 'border-color var(--dur-fast),box-shadow var(--dur-fast)'
    }
  }, rest)), (error || hint) && /*#__PURE__*/React.createElement("span", {
    style: {
      font: '400 12px/1.3 var(--font-sans)',
      color: error ? 'var(--red-dark)' : 'var(--text-muted)'
    }
  }, error || hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function Select({
  label,
  options = [],
  value,
  onChange,
  style
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      font: '700 13px/1.2 var(--font-sans)',
      color: 'var(--text-strong)'
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("select", {
    value: value,
    onChange: e => onChange && onChange(e.target.value),
    style: {
      appearance: 'none',
      width: '100%',
      height: 40,
      padding: '0 36px 0 14px',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border)',
      background: 'var(--background)',
      font: '400 15px/1 var(--font-sans)',
      color: 'var(--text-primary)'
    }
  }, options.map(o => {
    const v = typeof o === 'string' ? {
      value: o,
      label: o
    } : o;
    return /*#__PURE__*/React.createElement("option", {
      key: v.value,
      value: v.value
    }, v.label);
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      right: 14,
      top: '50%',
      transform: 'translateY(-50%)',
      pointerEvents: 'none',
      color: 'var(--text-secondary)',
      fontSize: 10
    }
  }, "\u25BC")));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/loop/AgentChip.jsx
try { (() => {
const T = {
  intent: 'var(--aladdin-blue)',
  red: 'var(--aladdin-red)',
  green: 'var(--aladdin-green)',
  gate: 'var(--aladdin-gold)',
  neutral: 'var(--text-muted)'
};
function AgentChip({
  name,
  model,
  tone = 'intent',
  status,
  style
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '4px 12px 4px 4px',
      borderRadius: 'var(--radius-pill)',
      background: 'var(--background)',
      border: '1px solid var(--border)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 24,
      height: 24,
      borderRadius: '50%',
      background: T[tone],
      color: tone === 'gate' ? 'var(--text-primary)' : '#fff',
      display: 'grid',
      placeItems: 'center',
      font: '700 11px/1 var(--font-mono)'
    }
  }, (name || '?').slice(0, 2)), /*#__PURE__*/React.createElement("span", {
    style: {
      font: '700 13px/1 var(--font-sans)',
      color: 'var(--text-primary)'
    }
  }, name), model && /*#__PURE__*/React.createElement("span", {
    style: {
      font: '400 12px/1 var(--font-sans)',
      color: 'var(--text-muted)'
    }
  }, model), status && /*#__PURE__*/React.createElement("span", {
    style: {
      font: '500 11px/1 var(--font-mono)',
      color: T[tone]
    }
  }, status));
}
Object.assign(__ds_scope, { AgentChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/loop/AgentChip.jsx", error: String((e && e.message) || e) }); }

// components/loop/GateVerdict.jsx
try { (() => {
const V = {
  pending: {
    tone: 'var(--aladdin-gold)',
    bg: 'var(--gate-surface)',
    bd: 'var(--gate-border)',
    glyph: '◆',
    word: 'Awaiting gate'
  },
  pass: {
    tone: 'var(--aladdin-green)',
    bg: 'var(--green-surface)',
    bd: 'var(--green-border)',
    glyph: '✓',
    word: 'Gate passed'
  },
  block: {
    tone: 'var(--aladdin-red)',
    bg: 'var(--red-surface)',
    bd: 'var(--red-border)',
    glyph: '✕',
    word: 'Gate blocked'
  },
  warn: {
    tone: 'var(--gold-dark)',
    bg: 'var(--gate-surface)',
    bd: 'var(--gate-border)',
    glyph: '!',
    word: 'Degraded — grep fallback'
  }
};
function GateVerdict({
  gate = 'gate-green',
  verdict = 'pending',
  reason,
  style
}) {
  const v = V[verdict] || V.pending;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start',
      padding: '12px 14px',
      background: v.bg,
      border: '1px solid ' + v.bd,
      borderRadius: 'var(--radius-md)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 28,
      height: 28,
      borderRadius: verdict === 'pending' ? 6 : '50%',
      transform: verdict === 'pending' ? 'rotate(45deg) scale(.82)' : 'none',
      background: v.tone,
      color: '#fff',
      display: 'grid',
      placeItems: 'center',
      font: '800 14px/1 var(--font-sans)',
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      transform: verdict === 'pending' ? 'rotate(-45deg)' : 'none'
    }
  }, verdict === 'pending' ? '' : v.glyph)), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      alignItems: 'baseline',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: '700 14px/1.3 var(--font-sans)',
      color: 'var(--text-primary)'
    }
  }, v.word), /*#__PURE__*/React.createElement("code", {
    style: {
      font: '500 12px/1.3 var(--font-mono)',
      color: 'var(--text-secondary)'
    }
  }, gate)), reason && /*#__PURE__*/React.createElement("div", {
    style: {
      font: '400 13px/1.45 var(--font-sans)',
      color: 'var(--text-strong)',
      marginTop: 2
    }
  }, reason)));
}
Object.assign(__ds_scope, { GateVerdict });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/loop/GateVerdict.jsx", error: String((e && e.message) || e) }); }

// components/loop/LoopStepper.jsx
try { (() => {
const STEPS = [{
  k: 'plan',
  label: 'Plan',
  tone: 'green',
  sub: ''
}, {
  k: 'red',
  label: 'Red',
  tone: 'red',
  sub: 'failing tests'
}, {
  k: 'scaffold',
  label: 'Scaffold',
  tone: 'intent',
  sub: 'stubs'
}, {
  k: 'green',
  label: 'Green',
  tone: 'green',
  sub: 'pass tests'
}, {
  k: 'review',
  label: 'Review',
  tone: 'gate',
  sub: 'structure'
}, {
  k: 'final',
  label: 'Final Gate',
  tone: 'gate',
  sub: 'end of sprint'
}];
const FG = {
  intent: 'var(--aladdin-blue)',
  red: 'var(--aladdin-red)',
  green: 'var(--aladdin-green)',
  gate: 'var(--aladdin-gold)'
};
function LoopStepper({
  current = null,
  done = [],
  compact = false,
  onSelect,
  style
}) {
  return /*#__PURE__*/React.createElement("ol", {
    style: {
      listStyle: 'none',
      margin: 0,
      padding: 0,
      display: 'flex',
      alignItems: 'flex-start',
      gap: 0,
      ...style
    }
  }, STEPS.map((s, i) => {
    const isCur = current === s.k;
    const isDone = done.includes(s.k);
    const d = compact ? 16 : 24;
    return /*#__PURE__*/React.createElement("li", {
      key: s.k,
      style: {
        display: 'flex',
        alignItems: 'flex-start',
        flex: i < STEPS.length - 1 ? 1 : 'none'
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: onSelect ? () => onSelect(s.k) : undefined,
      style: {
        all: 'unset',
        cursor: onSelect ? 'pointer' : 'default',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        minWidth: compact ? 52 : 72
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: d,
        height: d,
        borderRadius: '50%',
        background: FG[s.tone],
        opacity: isCur || isDone || current == null ? 1 : .35,
        boxShadow: isCur ? '0 0 0 4px var(--background),0 0 0 6px ' + FG[s.tone] : 'none',
        display: 'grid',
        placeItems: 'center',
        color: '#fff',
        font: '700 11px/1 var(--font-sans)',
        transition: 'opacity var(--dur-base) var(--ease-standard)'
      }
    }, isDone && !compact ? '✓' : ''), /*#__PURE__*/React.createElement("span", {
      style: {
        font: '700 13px/1.2 var(--font-sans)',
        color: 'var(--text-primary)'
      }
    }, s.label), !compact && s.sub && /*#__PURE__*/React.createElement("span", {
      style: {
        font: '400 11px/1.2 var(--font-sans)',
        color: 'var(--text-muted)',
        marginTop: -3
      }
    }, "(", s.sub, ")")), i < STEPS.length - 1 && /*#__PURE__*/React.createElement("span", {
      "aria-hidden": "true",
      style: {
        flex: 1,
        height: 1,
        background: 'var(--text-strong)',
        marginTop: d / 2,
        opacity: .5,
        minWidth: 12
      }
    }));
  }));
}
Object.assign(__ds_scope, { LoopStepper });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/loop/LoopStepper.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function Tabs({
  items = [],
  value,
  onChange,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    role: "tablist",
    style: {
      display: 'flex',
      gap: 4,
      borderBottom: '1px solid var(--border)',
      ...style
    }
  }, items.map(it => {
    const o = typeof it === 'string' ? {
      value: it,
      label: it
    } : it;
    const on = o.value === value;
    return /*#__PURE__*/React.createElement("button", {
      key: o.value,
      role: "tab",
      "aria-selected": on,
      onClick: () => onChange && onChange(o.value),
      style: {
        all: 'unset',
        cursor: 'pointer',
        padding: '10px 14px',
        font: (on ? '700' : '500') + ' 14px/1 var(--font-sans)',
        color: on ? 'var(--aladdin-blue)' : 'var(--text-secondary)',
        borderBottom: '3px solid ' + (on ? 'var(--aladdin-blue)' : 'transparent'),
        borderRadius: '3px 3px 0 0',
        marginBottom: -1,
        display: 'inline-flex',
        gap: 8,
        alignItems: 'center'
      }
    }, o.label, o.count != null && /*#__PURE__*/React.createElement("span", {
      style: {
        font: '500 11px/1 var(--font-mono)',
        color: 'var(--text-muted)'
      }
    }, o.count));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/ArtifactList.jsx
try { (() => {
function ArtifactList({
  items = [],
  tone = 'neutral',
  style
}) {
  const dot = {
    intent: 'var(--aladdin-blue)',
    red: 'var(--aladdin-red)',
    green: 'var(--aladdin-green)',
    gate: 'var(--aladdin-gold)',
    neutral: 'var(--text-muted)'
  }[tone];
  return /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: 'none',
      margin: 0,
      padding: '10px 12px',
      background: 'rgba(255,255,255,.7)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      ...style
    }
  }, items.map((it, i) => {
    const o = typeof it === 'string' ? {
      name: it
    } : it;
    return /*#__PURE__*/React.createElement("li", {
      key: i,
      style: {
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        font: '500 12px/1.4 var(--font-mono)',
        color: 'var(--text-strong)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: dot,
        flex: 'none',
        transform: 'translateY(-1px)'
      }
    }), /*#__PURE__*/React.createElement("span", null, o.name), o.note && /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-sans)'
      }
    }, o.note));
  }));
}
Object.assign(__ds_scope, { ArtifactList });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/ArtifactList.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/Panel.jsx
try { (() => {
const TONES = {
  intent: {
    fg: 'var(--aladdin-blue)',
    bg: 'var(--intent-surface)',
    bd: 'var(--intent-border)',
    dk: 'var(--blue-dark)'
  },
  red: {
    fg: 'var(--aladdin-red)',
    bg: 'var(--red-surface)',
    bd: 'var(--red-border)',
    dk: 'var(--red-dark)'
  },
  green: {
    fg: 'var(--aladdin-green)',
    bg: 'var(--green-surface)',
    bd: 'var(--green-border)',
    dk: 'var(--green-dark)'
  },
  gate: {
    fg: 'var(--aladdin-gold)',
    bg: 'var(--gate-surface)',
    bd: 'var(--gate-border)',
    dk: 'var(--gold-dark)'
  },
  neutral: {
    fg: 'var(--text-muted)',
    bg: 'var(--surface-neutral)',
    bd: 'var(--border)',
    dk: 'var(--text-strong)'
  }
};
function Panel({
  tone = null,
  step = null,
  title,
  subtitle,
  meta,
  children,
  style
}) {
  const t = tone ? TONES[tone] : null;
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: t ? t.bg : 'var(--background)',
      border: '1px solid ' + (t ? t.bd : 'var(--border)'),
      borderRadius: 'var(--radius-lg)',
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      ...style
    }
  }, (title || step != null) && /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, step != null && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 32,
      height: 32,
      borderRadius: '50%',
      background: t ? t.fg : 'var(--aladdin-blue)',
      color: tone === 'gate' ? 'var(--text-primary)' : '#fff',
      display: 'grid',
      placeItems: 'center',
      font: '800 16px/1 var(--font-sans)',
      flex: 'none'
    }
  }, step), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '700 18px/1.25 var(--font-sans)',
      color: t ? t.dk : 'var(--text-primary)',
      letterSpacing: '-.01em'
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("div", {
    style: {
      font: '400 13px/1.4 var(--font-sans)',
      color: 'var(--text-secondary)',
      marginTop: 2
    }
  }, subtitle)), meta), children);
}
Object.assign(__ds_scope, { Panel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/Panel.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/Terminal.jsx
try { (() => {
const C = {
  cmd: 'var(--term-fg)',
  out: 'var(--term-muted)',
  ok: 'var(--term-green)',
  fail: 'var(--term-red)',
  gate: 'var(--term-gold)',
  info: 'var(--term-blue)'
};
function Terminal({
  title = 'aladdin',
  lines = [],
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--term-bg)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      font: '400 13px/1.6 var(--font-mono)',
      color: 'var(--term-fg)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '10px 14px',
      borderBottom: '1px solid rgba(255,255,255,.08)'
    }
  }, ['#EA4335', '#F9AB00', '#34A853'].map(c => /*#__PURE__*/React.createElement("span", {
    key: c,
    style: {
      width: 10,
      height: 10,
      borderRadius: '50%',
      background: c,
      opacity: .85
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 8,
      color: 'var(--term-muted)',
      fontSize: 12
    }
  }, title)), /*#__PURE__*/React.createElement("pre", {
    style: {
      margin: 0,
      padding: '12px 16px',
      whiteSpace: 'pre-wrap'
    }
  }, lines.map((l, i) => {
    const o = typeof l === 'string' ? {
      t: 'out',
      text: l
    } : l;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        color: C[o.t] || C.out
      }
    }, o.t === 'cmd' && /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--term-blue)'
      }
    }, "$ "), o.text);
  })));
}
Object.assign(__ds_scope, { Terminal });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/Terminal.jsx", error: String((e && e.message) || e) }); }

// ui_kits/aloop/Screens.jsx
try { (() => {
const {
  Button,
  Badge,
  Panel,
  ArtifactList,
  Terminal,
  LoopStepper,
  GateVerdict,
  AgentChip,
  Input,
  Select,
  Switch,
  Tabs,
  Dialog,
  Toast,
  Signature,
  PhaseDot
} = window.AladdinDesignSystem_34d902;
function TopBar({
  phase,
  onReset
}) {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '14px 28px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--background)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      flexDirection: 'column',
      font: '800 20px/1 var(--font-sans)',
      letterSpacing: '-.02em',
      color: 'var(--aladdin-blue)'
    }
  }, "Aladdin", /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      height: 3,
      borderRadius: 2,
      overflow: 'hidden',
      marginTop: 4
    }
  }, ['blue', 'red', 'green', 'gold'].map(c => /*#__PURE__*/React.createElement("span", {
    key: c,
    style: {
      flex: 1,
      background: 'var(--aladdin-' + c + ')'
    }
  })))), /*#__PURE__*/React.createElement("span", {
    style: {
      font: '500 13px/1 var(--font-mono)',
      color: 'var(--text-muted)'
    }
  }, "~/api-gateway \xB7 sprint 3"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Badge, {
    tone: phase === 'intent' ? 'neutral' : phase === 'plan' ? 'intent' : phase === 'done' ? 'green' : 'gate',
    dot: true
  }, phase === 'intent' ? 'Idle' : phase === 'plan' ? 'Planning' : phase === 'done' ? 'Sprint closed' : 'Autonomous'), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    onClick: onReset
  }, "New intent"));
}
function IntentScreen({
  onSubmit
}) {
  const [v, setV] = React.useState('Add rate limiting to the API');
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 640,
      margin: '64px auto',
      padding: '0 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '800 44px/1.08 var(--font-sans)',
      letterSpacing: '-.03em'
    }
  }, "Intent is all you need"), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '400 17px/1.5 var(--font-sans)',
      color: 'var(--text-secondary)'
    }
  }, "Describe what you want in natural language. Agents explore; gates decide what becomes accepted software."), /*#__PURE__*/React.createElement(Input, {
    multiline: true,
    label: "Intent",
    value: v,
    onChange: e => setV(e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Select, {
    label: "Harness",
    options: ['Claude Code', 'Codex', 'OpenCode']
  }), /*#__PURE__*/React.createElement(Select, {
    label: "Budget",
    options: ['150K / 250K tokens', '80K / 120K tokens']
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    onClick: () => onSubmit(v)
  }, "Plan this intent"), /*#__PURE__*/React.createElement(Switch, {
    checked: true,
    label: "Auto re-plan (\u22642)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 22px/1.1 var(--font-hand)',
      color: 'var(--aladdin-blue)',
      transform: 'rotate(-2deg)',
      marginTop: 8
    }
  }, "Your intent summons possibility."));
}
function PlanScreen({
  intent,
  onApprove
}) {
  const [tab, setTab] = React.useState('stories');
  const [ask, setAsk] = React.useState(false);
  const stories = [['S-1', 'Token bucket per API key', '3 tasks'], ['S-2', '429 response + Retry-After header', '2 tasks'], ['S-3', 'Per-route limit config', '3 tasks']];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1040,
      margin: '32px auto',
      padding: '0 24px',
      display: 'grid',
      gridTemplateColumns: '1.4fr 1fr',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement(Panel, {
    tone: "intent",
    step: 1,
    title: "Intake \u2192 Standards \u2192 Planning",
    subtitle: '“' + intent + '”'
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(AgentChip, {
    name: "intake",
    model: "Opus",
    status: "\u2713"
  }), /*#__PURE__*/React.createElement(AgentChip, {
    name: "standards",
    model: "Opus",
    status: "\u2713"
  }), /*#__PURE__*/React.createElement(AgentChip, {
    name: "planner",
    model: "Opus",
    status: "\u2713"
  })), /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: setTab,
    items: [{
      value: 'stories',
      label: 'Stories',
      count: 3
    }, {
      value: 'criteria',
      label: 'Acceptance criteria',
      count: 7
    }, {
      value: 'standards',
      label: 'Standards'
    }]
  }), tab === 'stories' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, stories.map(s => /*#__PURE__*/React.createElement("div", {
    key: s[0],
    style: {
      display: 'flex',
      gap: 12,
      alignItems: 'center',
      padding: '10px 14px',
      background: 'var(--background)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)'
    }
  }, /*#__PURE__*/React.createElement("code", {
    style: {
      font: '500 12px/1 var(--font-mono)',
      color: 'var(--aladdin-blue)'
    }
  }, s[0]), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      font: '500 14px/1.3 var(--font-sans)'
    }
  }, s[1]), /*#__PURE__*/React.createElement("span", {
    style: {
      font: '400 12px/1 var(--font-sans)',
      color: 'var(--text-muted)'
    }
  }, s[2])))), tab === 'criteria' && /*#__PURE__*/React.createElement(ArtifactList, {
    tone: "intent",
    items: ['Returns 429 after N requests / window', 'Retry-After header is set', 'Limits reset per window', 'Limits configurable per route']
  }), tab === 'standards' && /*#__PURE__*/React.createElement(ArtifactList, {
    items: ['cargo fmt --check', 'clippy -D warnings', 'coverage ≥ 80%', 'no new public API without docs']
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Panel, {
    title: "Artifacts",
    subtitle: "Written to docs/sprints/03"
  }, /*#__PURE__*/React.createElement(ArtifactList, {
    tone: "intent",
    items: ['stories.md', 'plan.md', 'tasks.md', 'validate.md']
  })), /*#__PURE__*/React.createElement(Panel, {
    tone: "gate",
    title: "Your approval",
    subtitle: "Go / Feedback \u2014 nothing builds until you approve."
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "approve",
    onClick: () => setAsk(true)
  }, "Approve plan"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary"
  }, "Give feedback")))), ask && /*#__PURE__*/React.createElement(Dialog, {
    title: "Approve plan?",
    onClose: () => setAsk(false),
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      onClick: () => setAsk(false)
    }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
      variant: "approve",
      onClick: onApprove
    }, "Start autonomous run"))
  }, "3 stories \xB7 8 tasks \xB7 2 waves. Each task runs in its own git worktree. Gates decide what merges."));
}
const PH = {
  red: {
    tone: 'red',
    n: 2,
    title: 'Red — Write failing tests',
    agent: ['tester', 'Sonnet'],
    items: ['tests/*.test.*', 'test report', 'failure evidence'],
    gate: ['gate-red', 'Tests compile and fail — proof of what is missing.'],
    term: [{
      t: 'cmd',
      text: 'cargo test rate_limit'
    }, {
      t: 'fail',
      text: '✕ bucket_refills_per_window ... FAILED'
    }, {
      t: 'fail',
      text: '✕ returns_429_after_limit ... FAILED'
    }, {
      t: 'fail',
      text: '✕ sets_retry_after ... FAILED'
    }, {
      t: 'gate',
      text: '◆ gate-red  pass (3 failing, 0 compile errors)'
    }]
  },
  scaffold: {
    tone: 'intent',
    n: 3,
    title: 'Scaffold — Create stubs',
    agent: ['scaffolder', 'Sonnet'],
    items: ['created files (task worktree)', 'execution.log', 'output.md'],
    gate: ['gate-scaffold', 'Stubs only; no business logic detected.'],
    term: [{
      t: 'cmd',
      text: 'ctx-symbols check src/limit'
    }, {
      t: 'out',
      text: 'RateLimiter  count==1'
    }, {
      t: 'out',
      text: 'Bucket::take count==1'
    }, {
      t: 'gate',
      text: '◆ gate-scaffold pass'
    }]
  },
  green: {
    tone: 'green',
    n: 4,
    title: 'Green — Make tests pass',
    agent: ['green-worker', 'Sonnet'],
    items: ['implemented code', 'execution.log', {
      name: 'passing test report',
      note: '3/3'
    }],
    gate: ['gate-green', '3/3 tests pass in task worktree.'],
    term: [{
      t: 'cmd',
      text: 'cargo test rate_limit'
    }, {
      t: 'ok',
      text: '✓ bucket_refills_per_window'
    }, {
      t: 'ok',
      text: '✓ returns_429_after_limit'
    }, {
      t: 'ok',
      text: '✓ sets_retry_after'
    }, {
      t: 'gate',
      text: '◆ gate-green pass'
    }]
  },
  review: {
    tone: 'gate',
    n: 5,
    title: 'Review — per wave',
    agent: ['structural-reviewer', 'Sonnet'],
    items: ['structure check', 'duplication: none', 'suggestions: 1'],
    gate: ['gate-structural', 'No duplicate or orphan symbols.'],
    term: [{
      t: 'cmd',
      text: 'ctx-symbols dupes --wave 1'
    }, {
      t: 'out',
      text: '0 duplicates · 0 orphans'
    }, {
      t: 'gate',
      text: '◆ gate-structural pass'
    }]
  },
  final: {
    tone: 'gate',
    n: 5,
    title: 'Final Gate — end of sprint',
    agent: ['final-gate', 'Sonnet'],
    items: ['gate report', 'updated docs'],
    gate: ['final-verify', 'All checks pass. Approved for merge.'],
    term: [{
      t: 'cmd',
      text: 'md-db validate docs/'
    }, {
      t: 'ok',
      text: '✓ 12 docs valid'
    }, {
      t: 'ok',
      text: '✓ 322 tests pass'
    }, {
      t: 'gate',
      text: '◆ FINAL-GATE approved'
    }]
  }
};
const ORDER = ['red', 'scaffold', 'green', 'review', 'final'];
function RunScreen({
  onDone
}) {
  const [i, setI] = React.useState(0);
  const [verdict, setVerdict] = React.useState('pending');
  const [toast, setToast] = React.useState(null);
  const k = ORDER[i],
    p = PH[k];
  React.useEffect(() => {
    setVerdict('pending');
    const t = setTimeout(() => setVerdict('pass'), 900);
    return () => clearTimeout(t);
  }, [i]);
  const next = () => {
    if (i < ORDER.length - 1) {
      setToast(p.gate[0] + ' passed');
      setI(i + 1);
      setTimeout(() => setToast(null), 1800);
    } else onDone();
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1040,
      margin: '28px auto',
      padding: '0 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '18px 22px',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      background: 'var(--background)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '700 11px/1 var(--font-sans)',
      letterSpacing: '.06em',
      textTransform: 'uppercase',
      color: 'var(--text-muted)',
      marginBottom: 14
    }
  }, "The loop \xB7 wave 1 of 2"), /*#__PURE__*/React.createElement(LoopStepper, {
    current: k,
    done: ['plan', ...ORDER.slice(0, i)]
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.2fr 1fr',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement(Panel, {
    tone: p.tone,
    step: p.n,
    title: p.title,
    meta: /*#__PURE__*/React.createElement(AgentChip, {
      name: p.agent[0],
      model: p.agent[1],
      tone: p.tone
    })
  }, /*#__PURE__*/React.createElement(ArtifactList, {
    tone: p.tone,
    items: p.items
  }), /*#__PURE__*/React.createElement(GateVerdict, {
    gate: p.gate[0],
    verdict: verdict,
    reason: verdict === 'pass' ? p.gate[1] : 'Hook intercepting sub-agent stop…'
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Button, {
    variant: i === ORDER.length - 1 ? 'approve' : 'primary',
    disabled: verdict !== 'pass',
    onClick: next
  }, i === ORDER.length - 1 ? 'Merge & close sprint' : 'Continue'))), /*#__PURE__*/React.createElement(Terminal, {
    title: p.agent[0] + ' · task worktree',
    lines: p.term
  })), toast && /*#__PURE__*/React.createElement(Toast, {
    tone: "green",
    title: toast,
    style: {
      position: 'fixed',
      bottom: 24,
      left: '50%',
      transform: 'translateX(-50%)'
    }
  }, "Chain continues"));
}
function DoneScreen({
  onRestart
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1040,
      margin: '28px auto',
      padding: '0 24px',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement(Panel, {
    tone: "green",
    title: "Accepted state",
    subtitle: "3 stories merged \xB7 authored by you"
  }, /*#__PURE__*/React.createElement(ArtifactList, {
    tone: "green",
    items: [{
      name: '8 commits',
      note: 'merged to master'
    }, {
      name: '322 tests',
      note: 'passing'
    }, {
      name: '142K tokens',
      note: 'of 150K'
    }]
  })), /*#__PURE__*/React.createElement(Panel, {
    step: 0,
    tone: "neutral",
    title: "Retrospective (start next sprint)",
    subtitle: "archivist \xB7 Opus"
  }, /*#__PURE__*/React.createElement(ArtifactList, {
    items: ['stats.md + NEXT.md written', 'memory.md (updated)', 'context cleared → resume']
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Button, {
    onClick: onRestart
  }, "Start next intent"))), /*#__PURE__*/React.createElement("div", {
    style: {
      gridColumn: '1 / -1',
      font: '800 34px/1.15 var(--font-sans)',
      letterSpacing: '-.02em',
      textAlign: 'center',
      padding: '24px 0'
    }
  }, "Models explore. ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--gold-dark)'
    }
  }, "Gates decide.")));
}
Object.assign(window, {
  TopBar,
  IntentScreen,
  PlanScreen,
  RunScreen,
  DoneScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/aloop/Screens.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.PhaseDot = __ds_scope.PhaseDot;

__ds_ns.Signature = __ds_scope.Signature;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.AgentChip = __ds_scope.AgentChip;

__ds_ns.GateVerdict = __ds_scope.GateVerdict;

__ds_ns.LoopStepper = __ds_scope.LoopStepper;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.ArtifactList = __ds_scope.ArtifactList;

__ds_ns.Panel = __ds_scope.Panel;

__ds_ns.Terminal = __ds_scope.Terminal;

})();
