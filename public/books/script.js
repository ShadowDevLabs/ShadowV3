document.addEventListener('DOMContentLoaded', () => {
  fetchGames();
  setupEventListeners();
});

async function fetchGames() {
  try {
    const response = await fetch("games.json");
    if (!response.ok) throw new Error('Network response was not ok');
    const games = await response.json();
    renderGames(games);
  } catch (error) {
    console.error("Error loading games:", error);
  }
}

function renderGames(games) {
  const container = document.getElementById("gcontainer");

  games.sort((a, b) => a.name.localeCompare(b.name));

  const fragment = document.createDocumentFragment();

  const observer = createLazyLoadObserver();

  games.forEach((game) => {
    const gElement = createGameElement(game);
    fragment.appendChild(gElement);

    observer.observe(gElement);
  });

  container.appendChild(fragment);

  setupSearchFunctionality(container);
}

function createLazyLoadObserver() {
  return new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const gameElement = entry.target;
        const imgElement = gameElement.querySelector('img[data-src]');

        if (imgElement) {
          imgElement.src = imgElement.dataset.src;
          imgElement.removeAttribute('data-src');
        }

        observer.unobserve(gameElement);
      }
    });
  }, {
    rootMargin: '200px', 
    threshold: 0.01
  });
}

function createGameElement(game) {
  const gElement = document.createElement("div");
  gElement.classList.add("g");

  const imgElement = document.createElement("img");
  imgElement.dataset.src = `files/${game.root}/${game.img}`; 
  imgElement.alt = game.name;
  imgElement.classList.add("game-image");

  imgElement.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3C/svg%3E";

  const gameName = document.createElement("p");
  gameName.classList.add("game-name");
  gameName.textContent = game.name;

  const playButton = document.createElement("button");
  playButton.classList.add("game-play-button");
  playButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';

  gElement.dataset.root = game.root;
  gElement.dataset.file = game.file;
  gElement.dataset.name = game.name;
  gElement.dataset.img = `files/${game.root}/${game.img}`;

  gElement.appendChild(imgElement);
  gElement.appendChild(gameName);
  gElement.appendChild(playButton);

  return gElement;
}

function setupSearchFunctionality(container) {
  const searchBar = document.getElementById("__shadow-search-bar");

  let debounceTimeout;
  searchBar.addEventListener("input", () => {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      const query = searchBar.value.toLowerCase();

      requestAnimationFrame(() => {
        const gameElements = container.querySelectorAll(".g");
        gameElements.forEach((gameElement) => {
          const gameName = gameElement.dataset.name.toLowerCase();
          const match = gameName.includes(query);
          gameElement.style.display = match ? "flex" : "none";
        });
      });
    }, 150); 
  });
}

function setupEventListeners() {

  document.getElementById("gcontainer").addEventListener("click", (e) => {
    const gameElement = e.target.closest(".g");
    if (gameElement) {
      const root = gameElement.dataset.root;
      const file = gameElement.dataset.file;
      const name = gameElement.dataset.name;
      const img = gameElement.dataset.img;
      launch(`files/${root}/${file}`, name, img);
    }
  });

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
}

function launch(src, name, gameimg) {
  const gDisplay = document.querySelector(".gDisplay");
  const gDisplayImg = document.getElementById("gDisplayImg");
  const gDisplayName = document.getElementById("gDisplayName");
  const gIframe = document.getElementById("gIframe");

  gDisplayImg.src = gameimg;
  gDisplayName.textContent = name;

  gDisplay.classList.add("active");
  document.body.classList.add("no-scroll");

  setTimeout(() => {
    gIframe.src = src;
  }, 50);
}

function showiframe() {
  const gDisplay = document.querySelector(".gDisplay");
  const gIframe = document.getElementById("gIframe");
  gDisplay.classList.remove("active");

  setTimeout(() => {
    gIframe.src = "";
  }, 100);
  document.body.classList.remove("no-scroll");
}

function gameFullscreen(element) {
  if (!document.fullscreenElement) {
    element.requestFullscreen().catch(err => {
      console.error(`Error attempting to enable fullscreen: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
}