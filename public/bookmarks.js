// script.js

const bookmarksContainer = document.getElementById("bookmarks-container");

function addBookmark(title, url) {
  const bookmark = document.createElement("div");
  bookmark.className = "bookmark";
  bookmark.setAttribute("data-title", title);
  bookmark.setAttribute("data-url", url);
  const icon = document.createElement("i");
  icon.className = "fas fa-bookmark";
  const text = document.createElement("span");
  text.textContent = title;
  bookmark.appendChild(icon);
  bookmark.appendChild(text);

  bookmark.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    showBookmarkContextMenu(event, title, url, Array.from(bookmarksContainer.children).indexOf(bookmark));
  });

  bookmarksContainer.appendChild(bookmark);
}

function saveBookmarksToLocalStorage() {
  const bookmarks = Array.from(bookmarksContainer.children).map(bookmark => ({
    title: bookmark.getAttribute("data-title"),
    url: bookmark.getAttribute("data-url"),
  }));

  localStorage.setItem("bookmarks", JSON.stringify(bookmarks));
}

function loadBookmarksFromLocalStorage() {
  const storedBookmarks = localStorage.getItem("bookmarks");
  if (storedBookmarks) {
    const bookmarks = JSON.parse(storedBookmarks);
    bookmarks.forEach(bookmark => addBookmark(bookmark.title, bookmark.url));
  }
}

function showBookmarkContextMenu(event, title, url, index) {
  const contextMenu = document.createElement("div");
  contextMenu.className = "context-menu";
  contextMenu.innerHTML = `
    <div class="menu-item" onclick="editBookmark(${index})">Edit</div>
    <div class="menu-item" onclick="deleteBookmark(${index})">Delete</div>
  `;
  contextMenu.style.left = `${event.clientX}px`;
  contextMenu.style.top = `${event.clientY}px`;

  document.body.appendChild(contextMenu);

  document.addEventListener("click", () => {
    document.body.removeChild(contextMenu);
  });
}

function editBookmark(index) {
  const bookmarks = Array.from(bookmarksContainer.children);
  const bookmark = bookmarks[index];
  const textElement = bookmark.querySelector("span");

  const newTitle = prompt("Enter new title:", bookmark.getAttribute("data-title"));
  const newUrl = prompt("Enter new URL:", bookmark.getAttribute("data-url"));

  if (newTitle !== null && newUrl !== null) {
    bookmark.setAttribute("data-title", newTitle);
    bookmark.setAttribute("data-url", newUrl);
    textElement.textContent = newTitle;
    saveBookmarksToLocalStorage();
  }
}


function deleteBookmark(index) {
  const bookmarks = Array.from(bookmarksContainer.children);
  const bookmark = bookmarks[index];

  if (confirm(`Are you sure you want to delete the bookmark: ${bookmark.getAttribute("data-title")}?`)) {
    bookmarksContainer.removeChild(bookmark);
    saveBookmarksToLocalStorage();
  }
}

window.addEventListener("beforeunload", saveBookmarksToLocalStorage);
window.addEventListener("load", loadBookmarksFromLocalStorage);
