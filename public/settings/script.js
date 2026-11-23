fetch('themes.json')
  .then(response => response.json())
  .then(themes => {
    const themesContainer = document.getElementById('themes-container');

    themes.forEach(theme => {
      const themeDiv = document.createElement('div');
      themeDiv.classList.add('theme');
      themeDiv.onclick = () => {
        changeTheme(theme.value).then(() => window.fillCustomPickers?.());
      };
      // Each card previews its theme. The colours go in as variables once; the hover and the
      // underline are CSS (settings.css, .theme), so nothing is restyled while the pointer moves.
      for (const key of ['primary', 'text', 'border', 'accent', 'accent-light']) {
        themeDiv.style.setProperty(`--t-${key}`, theme.css[key]);
      }

      const colorDiv = document.createElement('div');
      colorDiv.classList.add('color');
      colorDiv.style.background = `linear-gradient(135deg, ${theme.css['primary']}, ${theme.css['secondary']}, ${theme.css['accent']}, ${theme.css['accent-light']})`;

      themeDiv.appendChild(colorDiv);
      themeDiv.appendChild(document.createTextNode(theme.name));

      themesContainer.appendChild(themeDiv);
    });
  })
  .catch(error => console.error('Error loading themes:', error));


function abtblank() {
  const url = window.location.href;
  const width = window.innerWidth;
  const height = window.innerHeight;

  let inFrame;

  try {
    inFrame = window !== top;
  } catch (e) {
    inFrame = true;
  }

  if (!inFrame && !navigator.userAgent.includes("Firefox")) {
    const popup = window.open("about:blank", `width=${width},height=${height}`);

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

async function wispURLOption() {
  const wispSelection = document.getElementById('wispSelection');
  const customWispURL = document.getElementById('wispURL');
  const setWispUrlBtn = document.getElementById('wispBtn');

  if (wispSelection.value === 'custom') {
    customWispURL.value = await window.settings.get("server");
    customWispURL.style.display = 'block';
    setWispUrlBtn.style.display = 'flex';
  } else {
    customWispURL.style.display = 'none';
    setWispUrlBtn.style.display = 'none';
    await window.settings.set("server", `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/wisp/`);
    top.tabs.setTransport();
  }
}