
# Shadow Browser V3
**ShadowV3** is a fast and feature-rich tab proxy designed with performance and user experience at its core. Finding proxies with smooth, functional tabs can be challenging, but we make it effortless. **THE BEST TABBED PROXY.**

---

# What's new in 3.4 (`slop` branch)
- 🚀 **Scramjet v2** replaces Ultraviolet as the proxy engine (`@mercuryworkshop/scramjet` 2.0.67-alpha.2 + `scramjet-controller` 0.0.14). bare-mux is gone; Epoxy and Libcurl talk to Wisp directly.
- 🧩 **Chrome extensions.** Install a `.crx`/`.zip` or paste a Chrome Web Store link at `shadow://extensions`. Content scripts, background pages/service workers, toolbar popups with badges, context menus, notifications, keyboard commands and most `chrome.*` APIs work, via [Sapphire](https://github.com/x8rr/sapphire).
- 📌 Pinned tabs, drag-to-reorder (without reloading the page), duplicate, close others / to the right, middle-click to close, and a right-click tab menu.
- ↩️ Reopen closed tabs.
- 💤 Restored sessions load lazily: only the active tab loads, the rest load when you click them. Sessions saved by older versions are converted automatically.
- ⌨️ Keyboard shortcuts that work from inside pages too (see below).
- 🔗 `/?url=<address>` opens Shadow straight to a page.
- 🖼️ Real site favicons, live tab titles, per-tab loading spinner, and an omnibox that follows in-page navigation without polling.
- 🛠️ Devtools (Eruda) is served locally instead of from a CDN.

- 🕹️ **Six built-in games** that need no assets or network — 2048, Snake, Brick Breaker, Minefield (minesweeper), Blocks, and Memory Match — bundled under `public/arcade/` and listed first in the arcade (`shadow://books`). They run self-contained, so they work even when the games-asset submodule isn't checked out.
- 🚨 **Panic key** (Settings → General): pick a key that instantly sends the whole window to a safe site. It works from inside proxied pages too and is ignored while you're typing.

### Keyboard shortcuts
| Keys | Action |
|---|---|
| `Alt+T` / `Alt+W` | New tab / close tab |
| `Alt+Shift+T` | Reopen closed tab |
| `Alt+L` | Focus the address bar |
| `Alt+R` | Reload |
| `Alt+←` / `Alt+→` | Back / forward |
| `Alt+1`…`Alt+8`, `Alt+9` | Switch to tab N / last tab |
| `Alt+[` / `Alt+]` | Previous / next tab |
| `Alt+D` / `Alt+P` | Duplicate / pin tab |

## Per-site compatibility patches
`public/assets/js/site-patches.js` applies fixups to proxied pages by hostname, so a site that needs a nudge (a bit of CSS, a small script) can be handled without touching the proxy engine. CSS-only fixes live in `public/assets/data/site-patches.json` and load live — add `{ "match": "example.com", "css": "...", "note": "why" }` and reload, no rebuild. `match` accepts `example.com` (domain + subdomains), `*.example.com` (subdomains only), or `~text` (hostname contains text). Script fixes go in the `JS_PATCHES` array in `site-patches.js`. It ships with no site fixes — real ones have to be written against live sites — but the framework is wired and runs whatever you add.

## Anti-fingerprinting
Optional per-deploy obfuscation (random DOM ids, page cloak, custom URL codec) lives in `src/server/obfuscation.mjs` and ships un-wired. See `OBFUSCATION.md` to switch it on.

## Building
`npm install` builds `public/dist/` automatically (and `npm start` rebuilds it if it's missing). To rebuild by hand: `npm run build`.

`scripts/build.mjs` applies one in-memory patch to Sapphire while bundling so it understands Shadow's XOR URL codec — the comment at the top of that file explains what and why. `node_modules` is never modified.

For local development against sites on your own machine or LAN, start with `WISP_ALLOW_PRIVATE=1 npm run dev`. Leave it unset in production.

## Licensing note
Scramjet v2, scramjet-controller and the Epoxy/Libcurl transports are **AGPL-3.0**. Shadow itself is GPL-3.0; the two combine, but the AGPL's network-use clause applies to a hosted deployment, so publish the source of what you run.

## Deployment
<a href="https://render.com/deploy?repo=https://github.com/ShadowDevLabs/ShadowV3">
  <img src="https://raw.githubusercontent.com/BinBashBanana/deploy-buttons/main/buttons/official/render.svg" alt="Deploy on Render">
</a>
<a href="https://app.cyclic.sh/api/app/deploy/ShadowDevLabs/ShadowV3">
  <img src="https://raw.githubusercontent.com/BinBashBanana/deploy-buttons/main/buttons/official/cyclic.svg" alt="Deploy on Cyclic">
</a>
<a href="https://vercel.com/new/clone?repositoryurl=https://github.com/ShadowDevLabs/ShadowV3">
  <img src="https://raw.githubusercontent.com/BinBashBanana/deploy-buttons/main/buttons/official/vercel.svg" alt="Deploy with Vercel">
</a>
<a href="https://app.koyeb.com/deploy?type=git&repository=github.com/ShadowDevLabs/Shadowv3">
  <img src="https://github.com/BinBashBanana/deploy-buttons/blob/main/buttons/official/koyeb.svg" alt="Deploy to Koyeb">
</a>

# Credits
- [NC](https://github.com/NCCoder2) ｜Developer
- [NotPeak](https://github.com/NottPeak)｜Developer
- [Scramjet](https://github.com/MercuryWorkshop/scramjet)｜Proxy
- [Sapphire](https://github.com/x8rr/sapphire)｜Extension runtime

# [Join the Discord](https://discord.gg/goshadow)

