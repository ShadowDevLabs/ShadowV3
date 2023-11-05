const bookmarksContainer = document.getElementById("bookmarks-container");
const bookmarks = JSON.parse(localStorage.getItem("bookmarks")) || [];

function saveBookmarks() {
  localStorage.setItem("bookmarks", JSON.stringify(bookmarks));
}

function loadBookmarks() {
  bookmarksContainer.innerHTML = '';
  bookmarks.forEach((bookmark) => {
    const { title, url } = bookmark;
    addBookmark(title, url);
  });
}


function isDuplicateBookmark(title, url) {
  return bookmarks.some((bookmark) => bookmark.title === title && bookmark.url === url);
}

function addBookmark(title, url) {
  const duplicateIndex = bookmarks.findIndex((bookmark) => bookmark.title === title && bookmark.url === url);
  
  if (duplicateIndex !== -1) {
    bookmarks.splice(duplicateIndex, 1); 
    const existingBookmark = bookmarksContainer.querySelector(`.bookmark[data-title="${title}"][data-url="${url}"]`);
    if (existingBookmark) {
      bookmarksContainer.removeChild(existingBookmark); 
    }
  }

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
    showBookmarkContextMenu(event, title, url);
  });

  bookmarksContainer.appendChild(bookmark);

  const bookmarkObj = { title, url };
  bookmarks.push(bookmarkObj);
  saveBookmarks();
}

function newBookmark(){
  const iframe = iframesContainer.children[currentTabIndex];
  addBookmark(iframe.contentWindow.document.title, iframe.src);
}


addBookmark("HI","H2I");
loadBookmarks();
