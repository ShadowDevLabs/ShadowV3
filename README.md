
# Shadow Browser V3
**ShadowV3** is a fast and feature-rich tab proxy designed with performance and user experience at its core. Finding proxies with smooth, functional tabs can be challenging, but we make it effortless. **THE BEST TABBED PROXY.**

---

# What's new in 3.4 (`slop` branch)
- 🚀 **Scramjet v2** replaces Ultraviolet as the proxy engine (`@mercuryworkshop/scramjet` 2.0.67-alpha.2 + `scramjet-controller` 0.0.14). bare-mux is gone; Epoxy and Libcurl talk to Wisp directly.
- 🧩 **Chrome extensions. A storefront UI lives at `shadow://store` (browse a curated catalog or paste any Chrome Web Store link/ID).** Install a `.crx`/`.zip` or paste a Chrome Web Store link at `shadow://extensions`. Content scripts, background pages/service workers, toolbar popups with badges, context menus, notifications, keyboard commands and most `chrome.*` APIs work, via [Sapphire](https://github.com/x8rr/sapphire).
- 📌 Pinned tabs, drag-to-reorder (without reloading the page), duplicate, close others / to the right, middle-click to close, and a right-click tab menu.
- ↩️ Reopen closed tabs.
- 💤 Restored sessions load lazily: only the active tab loads, the rest load when you click them. Sessions saved by older versions are converted automatically.
- ⌨️ Keyboard shortcuts that work from inside pages too (see below).
- 🔗 `/?url=<address>` opens Shadow straight to a page.
- 🖼️ Real site favicons, live tab titles, per-tab loading spinner, and an omnibox that follows in-page navigation without polling.
- 🛠️ Devtools (Eruda) is served locally instead of from a CDN.

- 🚨 **Panic key** (Settings → General): pick a key that instantly sends the whole window to a safe site. It works from inside proxied pages too and is ignored while you're typing.

- 🗂️ **Workspaces**: save the open tabs as a named set and bring it back later (menu → Workspaces, or the palette).
- 🪟 **Split view** (two tabs side by side, draggable divider), **private tabs** (nothing saved to history, the session or "reopen closed tab" — cookies are still shared with normal tabs), and **vertical tabs**.
- ⬇️ **Downloads manager**: attachments, non-displayable files, `<a download>` links, "save link/image/video" and screenshots are captured with progress, listed at `shadow://downloads`, and can be opened in a tab or saved again.
- 📖 **Reader mode**, **Translate page** (through Google Translate), **screenshot / clip tool**, picture-in-picture and "download this video" (menu → Page tools).
- ⭐ A real **bookmarks bar** with a star in the address bar, a customizable **speed dial** on the new-tab page, a **right-click menu** on proxied pages (Shift+right-click for the browser's own), and a **history page** with search, grouping and per-entry delete.
- 🎚️ **Per-site settings** (the tune button in the address bar): zoom, JavaScript on/off, dark mode and user agent, remembered per domain.
- 🎨 **Theme customizer** (accent color, wallpaper, custom CSS) and **dark mode for every site**.
- ☁️ **Cloud sync** of settings, bookmarks, shortcuts, workspaces and open tabs, end-to-end encrypted with a sync code (see below).
- 🧩 **Tab groups**: right-click a tab → *Add to new group*. Groups have a name and a colour, collapse when you click their chip, and are saved with the session. Drop a tab between two of a group's tabs (or on its chip) to add it.
- ↩️ **Per-tab Back/Forward**: every tab keeps its own history, so Back never changes a different tab. Right-click Back or Forward for the list of pages.
- 🔊 **Tab sound indicator and mute**: a speaker appears on tabs that are playing audio; click it (or `Alt+M`) to mute the tab. Works on websites; games from the built-in library are best effort.
- 🕘 **Recently closed tabs** under menu → History.
- ⚡ Scramjet now **boots lazily** on the first proxied page, the address bar **prewarms** connections, and the service worker **precaches** the shell.
- 📲 **Installable PWA**: the shell and Shadow's own pages still open with no connection.

### Keyboard shortcuts
| Keys | Action |
|---|---|
| `Alt+Shift+N` | New private tab |
| `Alt+M` | Mute / unmute tab |
| `Alt+S` | Split view on / off |
| `Alt+V` / `Alt+B` | Vertical tabs / bookmarks bar |
| `Alt+J` | Downloads |
| `Alt+Shift+R` / `Alt+Shift+S` | Reader mode / screenshot |
| `Alt+T` / `Alt+W` | New tab / close tab |
| `Alt+Shift+T` | Reopen closed tab |
| `Alt+L` | Focus the address bar |
| `Alt+R` | Reload |
| `Alt+←` / `Alt+→` | Back / forward |
| `Alt+1`…`Alt+8`, `Alt+9` | Switch to tab N / last tab |
| `Alt+[` / `Alt+]` | Previous / next tab |
| `Alt+D` / `Alt+P` | Duplicate / pin tab |
| `Alt+K` | Command palette (tabs, actions, quick open) |
| `Alt+F` | Find in page |
| `Alt+Enter` | Immersive (hide chrome) |
| `Alt +` / `Alt −` / `Alt 0` | Zoom in / out / reset |

## Cloud sync
Settings → Sync creates a sync code on one device; entering it on another links them. The browser derives an account id, an auth token and an AES-GCM key from the code — only the first two reach the server, which stores one encrypted blob per account (`src/server/sync.js`, endpoints under `/v1/api/sync/`). Records are JSON files in `SYNC_DIR` (default `./data/sync`), so it needs a writable disk: on read-only hosts (Vercel) the endpoints answer 503 and the rest of Shadow is unaffected. With several app servers behind the same domains, point `SYNC_DIR` at shared storage. Other knobs: `SYNC_DISABLED=1`, `SYNC_MAX_ACCOUNTS` (default 20000), `SYNC_MAX_BYTES` (default 65536).

## Per-site compatibility patches
`public/assets/js/site-patches.js` applies fixups to proxied pages by hostname, so a site that needs a nudge (a bit of CSS, a small script) can be handled without touching the proxy engine. CSS-only fixes live in `public/assets/data/site-patches.json` and load live — add `{ "match": "example.com", "css": "...", "note": "why" }` and reload, no rebuild. `match` accepts `example.com` (domain + subdomains), `*.example.com` (subdomains only), or `~text` (hostname contains text). Script fixes go in the `JS_PATCHES` array in `site-patches.js`. It ships with no site fixes — real ones have to be written against live sites — but the framework is wired and runs whatever you add.

## DOM obfuscation

`npm start` gives every id and class it can safely rename a random name, serves every CSS/JS file minified from a random path, disguises the shell's title, meta tags and favicon as another site (`SHADOW_CLOAK`), and gives each deploy its own proxy URL prefix and codec. `SHADOW_UI_SEED` keeps all of that the same across restarts (mirrors behind one load balancer must share it). `SHADOW_OBFUSCATE=off` turns it all off for debugging. [Configuration and verification](OBFUSCATION.md)

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

