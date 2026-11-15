// Entry for public/dist/shadow-proxy.js (see scripts/build.mjs).
//
// Requires /scramjet/scramjet.js and /controller/controller.api.js to have been
// loaded as classic scripts first: the two @mercuryworkshop imports below resolve
// to stubs that re-export globalThis.$scramjet / $scramjetController.
import { Controller, ManagedPlugin } from "@mercuryworkshop/scramjet-controller";
import { Sapphire } from "@x8r/sapphire";

/**
 * One per tab frame. Gives tabs.js the two things Ultraviolet used to give it
 * through uv.config.js / the service worker:
 *   - onDocument(ctx): called for every document that finishes initialising in
 *     the frame (top level and subframes), so the tab strip / omnibox / history
 *     can update without polling the iframe.
 *   - getUserAgent(): custom user-agent override, applied to outgoing requests.
 */
export class ShadowPlugin extends ManagedPlugin {
  constructor(handlers = {}) {
    super("shadow", []);
    this.handlers = handlers;
  }

  install(frame) {
    super.install(frame);

    this.tap(frame.hooks.init.post, (ctx) => {
      if (!ctx?.window) return;
      try {
        this.handlers.onDocument?.(ctx);
      } catch (e) {
        console.error("[shadow] document hook failed", e);
      }
    });

    this.tap(frame.hooks.fetch.request, (_ctx, props) => {
      const ua = this.handlers.getUserAgent?.();
      if (!ua || !props?.init) return;
      const headers = (props.init.headers ??= []);
      const existing = headers.find(([name]) => name.toLowerCase() === "user-agent");
      if (existing) existing[1] = ua;
      else headers.push(["user-agent", ua]);
    });
  }
}

export { Controller, Sapphire };
