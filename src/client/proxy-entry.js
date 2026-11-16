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
 *   - onNavigationResponse({url, destination, status, headers, body}): the raw
 *     response to a document navigation, before Scramjet rewrites it. Returning
 *     true means "I took the body" (a download): the navigation is then answered
 *     with 204 No Content, so the frame stays on the page it was showing.
 *   - onResponse({url, destination, status, headers}): every response after
 *     rewriting; `headers` is live, so response headers can be added here.
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

    this.tap(frame.hooks.fetch.preresponse, (ctx, props) => {
      const handler = this.handlers.onNavigationResponse;
      const response = props?.response;
      const destination = ctx?.parsed?.destination;
      if (!handler || !response?.body) return;
      if (destination !== "document" && destination !== "iframe") return;
      if (response.status < 200 || response.status >= 300) return;
      let taken = false;
      try {
        taken = handler({
          url: String(ctx.parsed.url),
          destination,
          status: response.status,
          headers: response.rawHeaders ?? [...response.headers],
          body: response.body,
        });
      } catch (e) {
        console.error("[shadow] navigation hook failed", e);
      }
      if (!taken) return;
      // Same shape as a BareResponse: a Response plus the raw header list.
      const empty = new Response(null, { status: 204, statusText: "No Content" });
      empty.rawHeaders = [];
      props.response = empty;
    });

    this.tap(frame.hooks.fetch.response, (ctx, props) => {
      const handler = this.handlers.onResponse;
      if (!handler || !props?.response?.headers) return;
      try {
        handler({
          url: String(ctx.parsed.url),
          destination: ctx.parsed.destination,
          status: props.response.status,
          headers: props.response.headers,
        });
      } catch (e) {
        console.error("[shadow] response hook failed", e);
      }
    });
  }
}

export { Controller, Sapphire };
