let currentGameIframe = null; 

function sortGames() {
  var gamesContainer = document.querySelector('.games-container');
  var games = Array.from(gamesContainer.getElementsByClassName('game'));

  games.sort(function(a, b) {
    var gameNameA = a.querySelector('.game-name').textContent.toLowerCase();
    var gameNameB = b.querySelector('.game-name').textContent.toLowerCase();
    return gameNameA.localeCompare(gameNameB);
  });

  gamesContainer.innerHTML = '';

  for (var i = 0; i < games.length; i++) {
    gamesContainer.appendChild(games[i]);
  }
}

window.addEventListener('DOMContentLoaded', sortGames);

function filterGames() {
  var searchInput = document.getElementById('searchInput');
  var filter = searchInput.value.toLowerCase();
  var gamesContainer = document.querySelector('.games-container');
  var games = gamesContainer.getElementsByClassName('game');

  for (var i = 0; i < games.length; i++) {
    var gameName = games[i].querySelector('.game-name').textContent.toLowerCase();
    if (gameName.indexOf(filter) > -1) {
      games[i].style.display = 'block';
    } else {
      games[i].style.display = 'none';
    }
  }
}

document.getElementById('searchInput').addEventListener('input', filterGames);

function loadGame(event, filePath) {
  const iframeContainer = document.querySelector('.iframe-container');
  const gametextname = document.getElementById('game-text-name');
  const gameTitle = document.querySelector('.game-title');
  const gameIframe = document.querySelector('.game-iframe');

  if (currentGameIframe) {
    currentGameIframe.src = ''; 
  }

  const clickedLink = event.currentTarget;
  const gameName = clickedLink.querySelector('.game-name').textContent;

  gameIframe.src = filePath;
  gametextname.innerHTML = `<div class="back-button"><i class="fas fa-arrow-left" onclick="closeGame()"></i> ${gameName}</div>`;
  iframeContainer.style.display = 'block';

  currentGameIframe = gameIframe; 
}

function closeGame() {
  if (currentGameIframe) {
    currentGameIframe.src = ''; 
    currentGameIframe = null; 
  }

  const iframeContainer = document.querySelector('.iframe-container');
  iframeContainer.style.display = 'none';
}