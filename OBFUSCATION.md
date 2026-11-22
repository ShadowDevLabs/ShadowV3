# Anti-fingerprinting (obfuscation)

`src/server/obfuscation.mjs` makes each deployment look different to a scraper
or filter. `index.js` wires it in with one call, `installObfuscation(app, { publicPath })`,
placed after the runtime mounts (`/dist`, `/scramjet`, `/controller`, `/epoxy`,
`/libcurl`, `/eruda`) and before the generic `express.static(publicPath)`.

It does five things:

| Piece | What a visitor gets |
|---|---|
| Random DOM names | Every id and class in the shell gets a random 5–9 character name, the same in every file |
| Random, minified assets | Every CSS/JS file loads from a random path (`/upb5f/k2q521cu3k.js` instead of `/assets/js/tabs.js`), minified; inline `<script>`/`<style>` are minified and HTML comments removed |
| Cloak | The shell's `<title>`, meta tags, favicon, `<html lang>` and the `ShadowV3` loading text come from another site |
| Font cipher | The pages' text is served as gibberish (`Tuoh Oporqvb`) that a per-deploy font draws as the real text (`Khan Academy`) |
| Proxy URLs | Proxied pages live under a random prefix (`/i7qu2c/…` instead of `/~/s/…`) and use a per-deploy codec |

## Settings

Set these before starting Node, and restart after changing them.

| Variable | Default | Effect |
|---|---|---|
| `SHADOW_OBFUSCATE` | on | `off` turns everything off and serves files as they are on disk |
| `SHADOW_UI_SEED` | random on each start | Drives the names, asset paths, prefix, codec key and `random` cloak. Set it to keep them the same across restarts. **Mirrors behind one load balancer must share it**, or a page from one server gets CSS from another |
| `SHADOW_CLOAK` | `example1` | A preset name from `CLOAK_PRESETS`, `random` (chosen by the seed) or `off` |

The presets (`example1`, `example2`) are placeholders pointing at example.com.
Edit `CLOAK_PRESETS` in `src/server/obfuscation.mjs` to the sites you want the
shell to pass as.

## How each piece works

**Random DOM names.** At startup the server reads every `.html/.css/.js` file in
`public/` (except `dist/`, `books/files/` and `assets/imgs/`) and finds every id
and class. A name is renamed only where it is certainly a DOM name: CSS selectors,
HTML `id`/`class`/`for`/`aria-*`/`href="#…"`, and JS strings passed to
`getElementById`, `classList.*`, `querySelector*`, `closest`, `matches`, `.className`
or a `class:` key, plus CSS and markup that scripts build as strings. A name keeps its original spelling if it also appears as plain
data (any other bare JS string, an HTML `value=`/`data-*` value, a JSON string, or a
`"prefix-"`/`"-suffix"` piece joined into ids). That keeps settings keys, theme names
and built-up ids working. `fa-*` (Font Awesome) is never renamed.

**Random, minified assets.** Each CSS/JS file is served at
`/<folder>/<name>.css|js`. The folder comes from the seed, and the name comes from the seed plus the
contents of every file, so any change gives new URLs, which can be cached forever.
Every quoted reference (`<link>`, `<script src>`, `import`, `importScripts`, the
service worker registration) points at the new path. Files are minified with esbuild:
comments, whitespace and local variable names go; top-level names stay, so inline
`onclick` handlers keep working. A file esbuild can't parse is served unminified, with
a warning at startup. The original URL (`/assets/js/tabs.js`) still answers with the
same renamed copy, so nothing gets a mismatched file. The service worker is served
from a random path too (with `Service-Worker-Allowed: /`). The server fills in its
`UI_ASSETS` list so it precaches the current files and drops older ones.

**Cloak.** `public/index.html` wraps its title, meta tags and favicon in
`<!--CLOAK:START-->` … `<!--CLOAK:END-->`. The server replaces that block. It
removes the markers even when the cloak is `off`, so they never reach the browser.
The tab cloak users pick in Settings still runs in the browser after the page loads.
The server cloak is what visitors without JS (scrapers, link previews) see.

**Font cipher.** `src/server/fontcipher.mjs`. The seed picks a swap of a–z (the same
swap for A–Z, so CSS `text-transform` still works) and 0–9, with no letter left in place.
Every text run in a served HTML page is swapped and wrapped in a seeded custom element
(`<ovk-una>Tuoh Oporqvb</ovk-una>`), so the HTML and the live DOM (Inspect Element) show
gibberish. At startup the server copies each web font the pages load (Poppins, Roboto, DM
Sans, Open Sans, Rubik, Bebas Neue: the exact TTFs Google Fonts serves, in
`src/server/fonts/`, OFL) and rewrites only its character map so each swapped letter
points at the real letter's glyph. Glyphs, kerning and ligatures are keyed by glyph, so
they stay right. The fonts are served from random immutable paths.

Each page declares a ciphered copy of every Google font it loads (in its HTML or its
stylesheets' `@import`), with only the weights it loads, so weights fall back as before.
A short script at the end of `<body>` gives each wrapper the ciphered copy of the font
its parent really draws in: the first font in the parent's stack that is ciphered (for
`"Inter", "Poppins"` that's Poppins, since Inter isn't loaded). Only text whose stack
reaches a generic or icon font first (monospace, system-ui, Material Symbols), or that is
italic, is put back as real text. `<script>`, `<style>`, `<title>`, `<textarea>`,
`<select>`, `<code>`/`<pre>`, `<svg>`, comments, entities and attributes are left
alone. Text that scripts set replaces the wrapper and shows normally.

To cipher a new Google font: add it to `FONTS` in `fontcipher.mjs` and drop
`<Name>-<weight>.ttf` into `src/server/fonts/` (the TTF that
`curl "https://fonts.googleapis.com/css2?family=<Name>:wght@<weight>"` links to).

**Proxy URLs.** `GET /v1/api/config` returns `{ prefix, codecKey }` (an empty
object when obfuscation is off). Before the proxy boots, `loadProxyConfig()` in
`public/assets/js/tabs.js` builds a codec from the key: character *i* is XORed with
key digit *i* (0–7), then percent-encoded. If the request fails, the page keeps the
built-in `/~/s/` prefix and Ultraviolet codec. The service worker learns the prefix
from the controller, and `__shadowUnproxy` (used by the Sapphire build patch)
reads `proxyConfig`, so neither needs changes. Saved tabs, history and bookmarks
store real URLs, so a new key after a restart loses nothing.

## Known limits

- Custom CSS a user typed in Settings → Themes, and extension code that targets
  shell classes by their original names, will stop matching.
- Without `SHADOW_UI_SEED`, a page left open across a server restart can't load
  assets it hasn't fetched yet (their paths changed) until it is reloaded.
- Page URLs (`/settings/`, `/pages/new.html`) and images keep their real paths.
- The font cipher hides the text from people too, not only from scrapers: copy/paste,
  find-in-page, translation and screen readers get the gibberish. If the font fails to
  load, people see gibberish as well.
- Text in a font that isn't ciphered (system, monospace, icon fonts) or in italic is put
  back as real text by that script, so a scraper that runs JS sees it.
- The font cipher doesn't cover attributes (`title`, `placeholder`, `aria-label`), the
  `<title>`, or text that scripts add.
- Minifying isn't encryption: the code still runs in the browser, so anyone
  determined can read it.

## Checking it

```sh
npm test                                         # font cipher, rewriter, asset paths, minifier, cloak, prefix and codec
curl -s localhost:PORT/v1/api/config             # random prefix + codecKey
curl -s localhost:PORT/ | head -20               # cloaked <title>/meta, no CLOAK markers
curl -s localhost:PORT/ | grep -c ShadowV3       # 0
curl -s localhost:PORT/ | grep -o 'class="[^"]*"' | head
curl -s localhost:PORT/ | grep -oE '(src|href)="[^"]+\.(js|css)"'   # random paths only
```

Then open the page and visit a site: the iframe path starts with the random
prefix, and the address bar shows the real URL.
