import { SettingsManager } from "./settings_manager.js";

class BookmarksManager {
  constructor() {
    this.settings = new SettingsManager();
    this.container = document.getElementById("bookmarks-container");
    window.addEventListener("load", this.load.bind(this));
  }

  addBookmark(title, url) {
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
    bookmark.addEventListener("click", (e) => this.onClick(e, bookmark));
    bookmark.addEventListener("contextmenu", (event) =>
      this.showBookmarkContextMenu(
        event,
        title,
        url,
        Array.from(this.container.children).indexOf(bookmark),
      ),
    );

    this.container.appendChild(bookmark);
    this.save();
  }

  async save() {
    const bookmarks = Array.from(this.container.children).map((bookmark) => ({
      title: bookmark.getAttribute("data-title"),
      url: bookmark.getAttribute("data-url"),
    }));

    await this.settings.set("bookmarks", bookmarks);
  }

  async load() {
    const storedBookmarks = await this.settings.get("bookmarks");
    if (storedBookmarks) {
      const bookmarks = JSON.parse(storedBookmarks);
      bookmarks.forEach((bookmark) =>
        this.addBookmark(bookmark.title, bookmark.url),
      );
    }
  }

  showBookmarkContextMenu(event, title, url, index) {
    event.preventDefault();
    //Rework code: very inefficient to make an entirely new element each right click, clutters and overlaps, easier way is to just use 1 and move it, then check the events target to get the bookmark info
    const contextMenu = document.createElement("div");
    contextMenu.className = "context-menu";
    contextMenu.innerHTML = `
            <div class="menu-item" onclick="bookmarksManager.editBookmark(${index})">Edit</div>
            <div class="menu-item" onclick="bookmarksManager.deleteBookmark(${index})">Delete</div>
        `;
    contextMenu.style.left = `${event.clientX}px`;
    contextMenu.style.top = `${event.clientY}px`;

    document.body.appendChild(contextMenu);

    document.addEventListener("click", () => {
      document.body.removeChild(contextMenu);
    });
  }

  editBookmark(index) {
    const bookmarks = Array.from(this.container.children);
    const bookmark = bookmarks[index];
    const textElement = bookmark.querySelector("span");

    const newTitle = prompt(
      "Enter new title:",
      bookmark.getAttribute("data-title"),
    );
    const newUrl = prompt("Enter new URL:", bookmark.getAttribute("data-url"));

    if (newTitle !== null && newUrl !== null) {
      bookmark.setAttribute("data-title", newTitle);
      bookmark.setAttribute("data-url", newUrl);
      textElement.textContent = newTitle;
      this.save();
    }
  }

  deleteBookmark(index) {
    const bookmarks = Array.from(this.container.children);
    const bookmark = bookmarks[index];

    if (
      confirm(
        `Are you sure you want to delete the bookmark: ${bookmark.getAttribute("data-title")}?`,
      )
    ) {
      this.container.removeChild(bookmark);
      this.save();
    }
  }

  onClick(e, bookmark) {
    const url = bookmark.getAttribute("data-url");
    if (e.shiftKey) {
      // Open in new tab
      tabs.createTab(url);
    } else {
      // Open in current tab
      tabs.load(url);
    }
  }

  newBookmark() {
    const iframesContainer = document.getElementById("iframes-container");
    const iframe = iframesContainer.children[activeTabIndex];
    this.addBookmark(iframe.contentWindow.document.title, tabs.parseUrl());
  }
}

const bookmarksManager = new BookmarksManager();
