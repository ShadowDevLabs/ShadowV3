fetch('themes.json')
  .then(response => response.json())
  .then(themes => {
    const themesContainer = document.getElementById('themes-container');

    themes.forEach(theme => {
      const themeDiv = document.createElement('div');
      themeDiv.classList.add('theme');
      themeDiv.onclick = () => {
        changeTheme(theme.value);
      };
      themeDiv.style.backgroundColor = theme.css['primary'];
      themeDiv.style.color = theme.css['text'];
      themeDiv.style.borderColor = theme.css['border'];

      const colorDiv = document.createElement('div');
      colorDiv.classList.add('color');
      colorDiv.style.background = `linear-gradient(135deg, ${theme.css['primary']}, ${theme.css['secondary']}, ${theme.css['accent']}, ${theme.css['accent-light']})`;
      colorDiv.style.borderColor = theme.css['accent-light'];

      const afterDiv = document.createElement('div');
      afterDiv.classList.add('theme-after');
      afterDiv.style.cssText = `height: 0.5px; width: 100%; position: absolute; bottom: 0; left: 0; background: linear-gradient(to right, ${theme.css['accent']}, ${theme.css['accent-light']}); transform: scaleX(0); transform-origin: bottom right; transition: transform 0.3s ease;`;
      themeDiv.appendChild(afterDiv);

      themeDiv.addEventListener('mouseover', () => {
        themeDiv.style.background = theme.css['active-tab'];
        themeDiv.style.boxShadow = `0 12px 24px ${theme.css['accent-glow']}`;
        themeDiv.style.borderColor = theme.css['accent'];
        afterDiv.style.transform = 'scaleX(1)';
        afterDiv.style.transformOrigin = 'bottom left';
      });

      themeDiv.addEventListener('mouseleave', () => {
        themeDiv.style.background = theme.css['secondary'];
        themeDiv.style.boxShadow = `0 4px 6px rgba(0, 0, 0, 0.1)`;
        themeDiv.style.borderColor = theme.css['border'];
        afterDiv.style.transform = 'scaleX(0)';
        afterDiv.style.transformOrigin = 'bottom right';
      });

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
    await window.settings.set("server", `wss://${location.host}/wisp/`);
    top.tabs.setTransport();
  }
}