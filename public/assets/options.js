const menuButton = document.getElementById("menu-button");
const dropdown = document.getElementById("menu-dropdown");
let isDropdownVisible = false;
const menuButtons = dropdown.querySelectorAll("button[data-add-tab]");
const iframesContainer = document.getElementById("iframes-container");

menuButtons.forEach((button) => {
  button.addEventListener("click", () => {
    dropdown.style.display = "none";
    isDropdownVisible = false;
  });
});

function toggleDropdown() {
  if (isDropdownVisible) {
    dropdown.style.display = "none";
  } else {
    dropdown.style.display = "block";
  }
  isDropdownVisible = !isDropdownVisible;
}

function closeMenu(event) {
  if (isDropdownVisible) {
    if (
      event.target !== menuButton &&
      !dropdown.contains(event.target) &&
      event.target !== menuButton
    ) {
      dropdown.style.display = "none";
      isDropdownVisible = false;
    }
  }
}

menuButton.addEventListener("click", toggleDropdown);

// Menu Buttons

function iframefullscreen() {
  const iframe = iframesContainer.children[activeTabIndex];
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
  const iframe = iframesContainer.children[activeTabIndex];
  const url = iframe.src;
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


function exit() {
  if (window.confirm("Are you sure you want to close this tab?")) {
    window.close();
  }
}
