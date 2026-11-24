// Window actions used by the toolbar menu (built in tabs.js): fullscreen and the
// about:blank cloaks.


function iframefullscreen() {
  // Look the iframe up through the tab list: tabs can be reordered, iframes are not.
  const iframe = tabs.tabsArr[tabs.activeTabIndex]?.iframe;
  if (!iframe) return;
  if (iframe.requestFullscreen) {
    iframe.requestFullscreen();
  } else if (iframe.mozRequestFullScreen) {
    iframe.mozRequestFullScreen();
  } else if (iframe.webkitRequestFullscreen) {
    iframe.webkitRequestFullscreen();
  } else if (iframe.msRequestFullscreen) {
    iframe.msRequestFullscreen();
  }
}

function abtblank() {
  const url = location.href;
  const width = window.innerWidth;
  const height = window.innerHeight;


  let inFrame;


  try {
    inFrame = window !== top;
  } catch (e) {
    inFrame = true;
  }


  if (!inFrame && !navigator.userAgent.includes("Firefox")) {
    const popup = window.open(
      "about:blank",
      name,
      `width=${width},height=${height}`,
    );

    if (!popup || popup.closed) {
      alert(
        "Allow popups and redirects to hide this from showing up in your history.",
      );
    } else {
      const doc = popup.document;
      const iframe = doc.createElement("iframe");
      // Screenshot, picture-in-picture and clipboard features need these inside the cloak window.
      iframe.allow = "display-capture; picture-in-picture; fullscreen; clipboard-read; clipboard-write";
      const style = iframe.style;
      const link = doc.createElement("link");

      iframe.src = url;
      style.position = "fixed";
      style.top = style.bottom = style.left = style.right = 0;
      style.border = style.outline = "none";
      style.width = style.height = "100%";


      doc.head.appendChild(link);
      doc.body.appendChild(iframe);
      window.location.replace("https://google.com");
    }
  }
}

function iframeabtblank() {
  // The proxied iframe URL dies once we navigate away, so open a fresh Shadow in the about:blank window at the real URL.
  const current = tabs.parseUrl();
  const url = `${location.origin}/?url=${encodeURIComponent(current)}`;
  const width = window.innerWidth;
  const height = window.innerHeight;


  let inFrame;


  try {
    inFrame = window !== top;
  } catch (e) {
    inFrame = true;
  }


  if (!inFrame && !navigator.userAgent.includes("Firefox")) {
    const popup = window.open("about:blank", "_blank", `width=${width},height=${height}`);


    if (!popup || popup.closed) {
      alert(
        "Allow popups and redirects to hide this from showing up in your history.",
      );
    } else {
      const doc = popup.document;
      const iframe = doc.createElement("iframe");
      const style = iframe.style;
      const link = doc.createElement("link");

      iframe.src = url;
      style.position = "fixed";
      style.top = style.bottom = style.left = style.right = 0;
      style.border = style.outline = "none";
      style.width = style.height = "100%";


      doc.head.appendChild(link);
      doc.body.appendChild(iframe);
      window.location.replace("https://google.com");
    }
  }
}


function exit() {
  if (window.confirm("Are you sure you want to close this tab?")) {
    window.close();
  }
}
