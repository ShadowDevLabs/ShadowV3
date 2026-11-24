// Entry for public/dist/shadow-proxy.js (see scripts/build.mjs).
//
// Needs scramjet.js and controller.api.js loaded first as classic scripts; the imports below are stubs for their globals.
import { Controller, ManagedPlugin } from "@mercuryworkshop/scramjet-controller";
import { Sapphire } from "@x8r/sapphire";

/**
 * One per tab frame. Hooks for tabs.js:
 *   - onDocument(ctx): each document in the frame once initialised
 *   - getUserAgent(): user-agent override
 *   - onNavigationResponse(...): raw navigation response before rewriting. Return true if a download took it (frame gets a 204)
 *   - onResponse(...): every response after rewriting; `headers` is live
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

    // Chromium bug: view transitions crash YouTube, so finish them at once.
    // https://github.com/MercuryWorkshop/scramjet/issues/222
    this.tap(frame.hooks.init.post, (ctx) => {
      const client = ctx?.client;
      client?.Proxy("Document.prototype.startViewTransition", {
        apply(call) {
          call.call()?.skipTransition(); // call() also hands the page its ViewTransition
        },
      });
      // pushState/replaceState with no URL should keep the current one, but Scramjet's hook turns it into
      // "/undefined" (seen on DuckDuckGo). Pass the current URL explicitly.
      client?.Proxy(["History.prototype.pushState", "History.prototype.replaceState"], {
        apply(call) {
          if (call.args[2] == null) call.args[2] = client.url.href;
        },
      });
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
