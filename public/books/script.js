fetch("games.json")
  .then((response) => response.json())
  .then((games) => {
    const container = document.getElementById("gcontainer");
    games.sort((a, b) => a.name.localeCompare(b.name));
    const fragment = document.createDocumentFragment();
    games.forEach((game) => {
      const gElement = document.createElement("div");
      gElement.classList.add("g");
      const imgElement = document.createElement("img");
      imgElement.src = `files/${game.root}/${game.img}`;
      imgElement.alt = game.name;
      imgElement.classList.add("game-image");
      imgElement.loading = "lazy";
      const gameName = document.createElement("p");
      gameName.classList.add("game-name");
      gameName.textContent = game.name;
      gElement.addEventListener("click", () => {
        launch(`files/${game.root}/${game.file}`, game.name, `files/${game.root}/${game.img}`);
      });
      gElement.appendChild(imgElement);
      gElement.appendChild(gameName);
      fragment.appendChild(gElement);
    });
    container.appendChild(fragment);
    const searchBar = document.getElementById("__shadow-search-bar");
    searchBar.addEventListener("input", () => {
      const query = searchBar.value.toLowerCase();
      const gameElements = container.querySelectorAll(".g");
      gameElements.forEach((gameElement) => {
        const gameName = gameElement.querySelector(".game-name");
        const match = gameName && gameName.textContent.toLowerCase().includes(query);
        gameElement.style.display = match ? "flex" : "none";
      });
    });
  })
  .catch((error) => console.error("Error loading games:", error));

function launch(src, name, gameimg) {
  const gDisplay = document.querySelector(".gDisplay");
  const gDisplayImg = document.getElementById("gDisplayImg");
  const gDisplayName = document.getElementById("gDisplayName");
  const gIframe = document.getElementById("gIframe");
  gDisplayImg.src = gameimg;
  gDisplayName.textContent = name;
  gIframe.src = src;
  gDisplay.classList.add("active");
  document.body.classList.add("no-scroll");
}

function showiframe() {
  const gDisplay = document.querySelector(".gDisplay");
  const gIframe = document.getElementById("gIframe");
  gDisplay.classList.remove("active");
  gIframe.src = "";
  document.body.classList.remove("no-scroll");
}

function gameFullscreen(element) {
  if (!document.fullscreenElement) {
    element.closest(".gDisplay").requestFullscreen();
  } else {
    document.exitFullscreen();
  }
}

document.getElementById("fullscreen").addEventListener("click", () => {
  const iframeContainer = document.querySelector(".gDisplay");
  gameFullscreen(iframeContainer);
});

document.getElementById("exit").addEventListener("click", () => {
  showiframe();
});

document.getElementById("refresh").addEventListener("click", () => {
  const gIframe = document.getElementById("gIframe");
  gIframe.contentWindow.location.reload();
});