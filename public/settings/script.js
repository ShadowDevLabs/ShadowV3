setOptions();

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

      const colorDiv = document.createElement('div');
      colorDiv.classList.add('color');
      colorDiv.style.background = `linear-gradient(135deg, ${theme.css['background-color']}, ${theme.css['tab-background']}, ${theme.css['tab-border']}, ${theme.css['accent-color']})`;

      themeDiv.style.backgroundColor = theme.css['tab-background'];
      themeDiv.style.color = theme.css['text-color'];
      themeDiv.style.borderColor = theme.css['tab-border'];

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


function wispURLOption() {
  const wispSelection = document.getElementById('wispSelection');
  const customWispURL = document.getElementById('wispURL');
  const setWispUrlBtn = document.getElementById('wispBtn');

  if (wispSelection.value === 'custom') {
    customWispURL.style.display = 'block';
    setWispUrlBtn.style.display = 'flex';
  } else {
    customWispURL.style.display = 'none';
    setWispUrlBtn.style.display = 'none';
    setWispUrl(`wss://${location.host}/wisp/`);
  }
}

function setOptions() {
  document.getElementById("autoBlankSwitch").checked = JSON.parse(localStorage.getItem('autoBlank'));
}