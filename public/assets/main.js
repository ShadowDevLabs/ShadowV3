const maxShortcuts = 10;
const addShortcutButton = document.querySelector(".shortcut.add");
const modal = document.getElementById("modal");
const closeButton = document.querySelector(".close");
addShortcutButton.addEventListener("click", () => {
  modal.style.display = "block";
});
closeButton.addEventListener("click", () => {
  modal.style.display = "none";
});
window.addEventListener("click", (event) => {
  if (event.target === modal) {
    modal.style.display = "none";
  }
});
const addShortcut = document.getElementById("add-shortcut");
const shortcutName = document.getElementById("shortcut-name");
const shortcutUrl = document.getElementById("shortcut-url");
const shortcutForm = document.getElementById("shortcut-form");
const shortcutsContainer = document.querySelector(".shortcuts");
shortcutUrl.addEventListener("keypress", (e) => {
  if (e.key == "Enter") addShortcutClicked();
});
shortcutName.addEventListener("keypress", (e) => {
  if (e.key == "Enter") addShortcutClicked();
});
addShortcut.addEventListener("click", addShortcutClicked);
function addShortcutClicked() {
  if (shortcutsContainer.querySelectorAll(".shortcut").length >= maxShortcuts) {
    alert(
      "You've reached the maximum number of shortcuts (10). Please delete some shortcuts to add new ones.",
    );
    return;
  }
  const name = shortcutName.value;
  const url = shortcutUrl.value;
  if (name && url) {
    const newShortcut = document.createElement("a");
    newShortcut.className = "shortcut";
    const domain = url;
    const size = 64;
    const imgSrc = `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
    newShortcut.innerHTML = `
        <img src="${imgSrc}">
        <p>${name}</p>
      `;
    newShortcut.setAttribute("data-url", url);
    shortcutsContainer.insertBefore(newShortcut, addShortcutButton);
    const shortcuts = JSON.parse(localStorage.getItem("shortcuts")) || [];
    shortcuts.push({ name, url });
    localStorage.setItem("shortcuts", JSON.stringify(shortcuts));
    modal.style.display = "none";
    shortcutForm.reset();
  }
}
function loadShortcuts() {
  const shortcuts = JSON.parse(localStorage.getItem("shortcuts")) || [];
  shortcuts.slice(0, maxShortcuts).forEach((shortcut) => {
    const { name, url } = shortcut;
    const newShortcut = document.createElement("a");
    newShortcut.className = "shortcut";
    const domain = url;
    const size = 64;
    const imgSrc = `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
    newShortcut.innerHTML = `
      <img src="${imgSrc}">
      <p>${name}</p>
    `;
    newShortcut.setAttribute("data-url", url);
    shortcutsContainer.insertBefore(newShortcut, addShortcutButton);
  });
}
document.addEventListener("DOMContentLoaded", () => {
  loadShortcuts();
});
const contextMenu = document.getElementById("shortcut-context-menu");
let selectedShortcut;
shortcutsContainer.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  const shortcut = event.target.closest(".shortcut");
  if (shortcut && shortcut !== addShortcutButton) {
    selectedShortcut = shortcut;
    contextMenu.style.left = `${event.pageX}px`;
    contextMenu.style.top = `${event.pageY}px`;
    contextMenu.style.display = "block";
  }
});
document.addEventListener("click", () => {
  contextMenu.style.display = "none";
});
document
  .getElementById("edit-context-menu-option")
  .addEventListener("click", () => {
    contextMenu.style.display = "none";
    const name = selectedShortcut.querySelector("p").textContent;
    const url = selectedShortcut.getAttribute("data-url");
    const imgSrc = `https://www.google.com/s2/favicons?domain=${url}&sz=64`;
    const editModal = document.getElementById("edit-shortcut-modal");
    const editNameInput = document.getElementById("edit-shortcut-name");
    const editUrlInput = document.getElementById("edit-shortcut-url");
    editNameInput.value = name;
    editUrlInput.value = url;
    editModal.style.display = "block";
    document.getElementById("edit-shortcut").addEventListener("click", edited);
    editNameInput.addEventListener("keypress", (e) => {
      if (e.key == "Enter") edited();
    });
    editUrlInput.addEventListener("keypress", (e) => {
      if (e.key == "Enter") edited();
    });
    function edited() {
      selectedShortcut.querySelector("p").textContent = editNameInput.value;
      const newURL = editUrlInput.value;
      selectedShortcut.setAttribute("data-url", newURL);
      const newImgSrc = `https://www.google.com/s2/favicons?domain=${newURL}&sz=64`;
      selectedShortcut.querySelector("img").src = newImgSrc;
      const shortcuts = JSON.parse(localStorage.getItem("shortcuts")) || [];
      const selectedShortcutIndex = shortcuts.findIndex(
        (shortcut) => shortcut.name === name,
      );
      if (selectedShortcutIndex !== -1) {
        shortcuts[selectedShortcutIndex] = {
          name: editNameInput.value,
          url: newURL,
        };
        localStorage.setItem("shortcuts", JSON.stringify(shortcuts));
      }
      editModal.style.display = "none";
    }
  });
document.getElementById("closeedit").addEventListener("click", () => {
  const editModal = document.getElementById("edit-shortcut-modal");
  editModal.style.display = "none";
});
document
  .getElementById("delete-context-menu-option")
  .addEventListener("click", () => {
    contextMenu.style.display = "none";
    if (selectedShortcut !== addShortcutButton) {
      selectedShortcut.remove();
      const name = selectedShortcut.querySelector("p").textContent;
      const shortcuts = JSON.parse(localStorage.getItem("shortcuts")) || [];
      const updatedShortcuts = shortcuts.filter(
        (shortcut) => shortcut.name !== name,
      );
      localStorage.setItem("shortcuts", JSON.stringify(updatedShortcuts));
    }
  });

function handleShortcutClick(event) {
  event.preventDefault();
  const shortcut = event.target.closest(".shortcut");
  if (shortcut && !shortcut.classList.contains("add")) {
    if (event.shiftKey) {
      parent.createTab(shortcut.getAttribute("data-url"));
    } else {
      parent.load(shortcut.getAttribute("data-url"));
    }
  }
}

shortcutsContainer.addEventListener("click", handleShortcutClick);

document.getElementById("uv-form").addEventListener("submit", (e) => {
  e.preventDefault();
  parent.load(document.getElementById("uv-address").value);
});
