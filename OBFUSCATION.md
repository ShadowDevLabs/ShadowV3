# Anti-fingerprinting (obfuscation)

`src/server/obfuscation.mjs` makes each deployment look different to a scraper
or filter. `index.js` wires it in with one call, `installObfuscation(app, { publicPath, runtime })`,
placed before the generic `express.static(publicPath)`. `runtime` lists the proxy runtime's
files; `index.js` mounts their usual folders (`/scramjet`, `/controller`, `/epoxy`, `/libcurl`,
`/eruda`, `/dist`) only when obfuscation is off.

It does six things:

| Piece | What a visitor gets |
|---|---|
| Random DOM names | Every id and class in the shell gets a random 5–9 character name, the same in every file |
| Random, minified assets | Every CSS/JS file loads from a random path (`/upb5f/k2q521cu3k.js` instead of `/assets/js/tabs.js`), minified; inline `<script>`/`<style>` are minified and HTML comments removed |
| Cloak | The shell's `<title>`, meta tags, favicon, `<html lang>` and the `ShadowV3` loading text come from another site |
| Font cipher | The pages' text is served as gibberish (`Tuoh Oporqvb`) that a per-deploy font draws as the real text (`Khan Academy`) |
| Proxy URLs | Proxied pages live under a random prefix (`/i7qu2c/…` instead of `/~/s/…`) and use a per-deploy codec |
| Proxy runtime | Scramjet, its controller, the epoxy and libcurl transports, eruda, our bundles and the Wisp endpoint answer only at random paths, with per-deploy bytes, and the globals they put in proxied pages get random names |

## Settings

Set these before starting Node, and restart after changing them.

| Variable | Default | Effect |
|---|---|---|
| `SHADOW_OBFUSCATE` | on | `off` turns everything off and serves files as they are on disk |
| `SHADOW_UI_SEED` | random on each start | Drives the names, asset paths, prefix, codec key and `random` cloak. Set it to keep them the same across restarts. **Mirrors behind one load balancer must share it**, or a page from one server gets CSS from another |
| `SHADOW_CLOAK` | `random` | A preset name from `CLOAK_PRESETS`, `random` (chosen by the seed, so each `SHADOW_DOMAINS` domain gets its own) or `off`. An unknown name counts as `random` |
| `SHADOW_DOMAINS` | none | Comma-separated domains (`a.com,b.org`). Each one gets its own site: its own names, asset paths, cloak, font cipher, prefix and codec, built from `SHADOW_UI_SEED` and the domain on its first request (about 0.2 s, once per worker). Its subdomains share that site, so made-up subdomains can't make the server build more. Any other `Host` gets the default site. It's also the list Caddy may get certificates for (below) |
| `SHADOW_SITE_CACHE` | 300 | How many domains' sites each process keeps in memory (about 3 MB each, stored gzipped), most recently used first. Others are rebuilt when visited again |
| `SHADOW_WORKERS` | 1 | Processes `npm start` runs (`start.js`), sharing one port. Each keeps its own site cache |

Edit `CLOAK_PRESETS` in `src/server/obfuscation.mjs` to the sites you want the
shell to pass as.

## Many domains with Caddy on_demand TLS

Point any number of domains (or a wildcard DNS record) at one server. Caddy gets a
certificate for each domain the first time someone visits it. Before it does, Caddy asks
`GET /v1/api/tls-ask?domain=…`, which answers 200 only for `SHADOW_DOMAINS` (403
otherwise), so nobody can make the server request certificates for domains of their own.
The route runs before basic auth, since Caddy sends no credentials, and only exists when
`SHADOW_DOMAINS` is set. The Caddyfile hides it from visitors (`respond … 404`): otherwise
anyone could ask one of your domains whether another one is yours. Caddy's own `ask` goes
straight to `localhost`, past that block.

```caddyfile
{
	on_demand_tls {
		ask http://localhost:8080/v1/api/tls-ask
	}
}

https:// {
	tls {
		on_demand
	}
	respond /v1/api/tls-ask 404
	reverse_proxy localhost:8080
}
```

Start Node with, for example, `SHADOW_DOMAINS=a.com,b.org SHADOW_UI_SEED=<secret>`. Set the
seed: without one, every restart gives every domain a new look. Caddy passes `Host`
through unchanged, and Node picks the site from that header. Responses carry `Vary: Host`.
Domains look unrelated to each other in the HTML, CSS, JS and URLs they serve, but they
come from one server: same IP, same TLS fingerprint, and the same paths for `/v1/api/*`,
`/dist/`, `/scramjet/` and the other runtime files.

## Running on one large server

On a many-core machine, put these in `.env` next to `index.js`:

```sh
SHADOW_UI_SEED=<32+ random characters>   # required with more than one worker: all must serve the same paths
CSRF_SECRET=<64 random characters>        # the AI page's tokens; random per process otherwise
SHADOW_WORKERS=16                         # leave some cores for Caddy's TLS
SHADOW_DOMAINS=a.com,b.org,…
```

Memory is roughly `SHADOW_WORKERS × (150 MB + SHADOW_SITE_CACHE × 3 MB)` at most: 16 workers
with the default cache stay under 20 GB (measured: one process serving 1,000 domains levels off
at 1.1 GB). Only Caddy should reach Node: block the Node port
from outside (`ufw deny 8080`). Node trusts `X-Forwarded-For` only from localhost, so rate
limits see the real client address.

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

**Proxy runtime.** The files in `runtime` (index.js) are minified once at startup. Each
site then serves them at `/<folder>/<name>.js|.wasm`, with the name taken from the seed and
the file's contents, never at their usual paths (those answer 404). Every reference follows:
`loadScript`/`import`/`importScripts` in the shell, the controller's `scramjetPath`,
`injectPath` and `wasmPath` defaults, and the transport choices in Settings. The Wisp endpoint
moves from `/wisp/` to a random path, which the server's upgrade handler accepts. Custom Wisp
servers keep `/wisp/`. Each JS file gets a seeded trailing comment, and the wasm a seeded
custom section, so no two deploys share a file hash.

Proxied pages can see globals, and Scramjet's are recognisable (`$scramjet`,
`$scramjetController`, `$scramjet$wrap` and the other rewriter helpers), as are the
controller's message names. They are renamed to random plain words of the same length. The
rewriter (`scramjet.wasm`) writes some of them into rewritten code itself (`$scramerr(`,
`$scramitize(`, `$scramjet$setrealmfn`, the `/*scramtag` marker), so the same names are swapped
in place in the wasm. Startup fails if one is left there after a package update. The
controller hides its inject script from pages' stack traces and performance entries by file
name (`maskedfiles`); that list gets the new names, plus scramjet.js, which upstream leaves
visible. The cookie jar's IndexedDB gets a fixed generic name, the same for every seed, so a
restart doesn't log anyone out of proxied sites.

## Known limits

- Custom CSS a user typed in Settings → Themes, and extension code that targets
  shell classes by their original names, will stop matching.
- Without `SHADOW_UI_SEED`, a page left open across a server restart can't load
  assets it hasn't fetched yet (their paths changed) until it is reloaded.
- Page URLs (`/settings/`, `/pages/new.html`) and images keep their real paths, and so does
  `/v1/api/config`.
- Inside the runtime files, strings stay as written (log and error messages, Scramjet's flag
  names). Sapphire's names (`__sapphire_user_script__`, its databases) stay too, because
  installed extensions are saved under them.
- The first deploy with the cookie jar's new name logs everyone out of proxied sites once.
- Without `SHADOW_UI_SEED`, a new seed after a restart gives a stale libcurl choice back to
  epoxy, because the saved path no longer says which transport it was.
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
npm test                                         # font cipher, rewriter, asset paths, minifier, cloak, prefix, codec, per-domain sites
curl -s localhost:PORT/v1/api/config             # random prefix + codecKey
curl -s -o /dev/null -w '%{http_code}
' localhost:PORT/scramjet/scramjet.js   # 404: the runtime only answers at seeded paths
curl -s -H 'Host: a.com' localhost:PORT/v1/api/config   # a different prefix per SHADOW_DOMAINS host
curl -s localhost:PORT/ | head -20               # cloaked <title>/meta, no CLOAK markers
curl -s localhost:PORT/ | grep -c ShadowV3       # 0
curl -s localhost:PORT/ | grep -o 'class="[^"]*"' | head
curl -s localhost:PORT/ | grep -oE '(src|href)="[^"]+\.(js|css)"'   # random paths only
```

Then open the page and visit a site: the iframe path starts with the random
prefix, and the address bar shows the real URL.
