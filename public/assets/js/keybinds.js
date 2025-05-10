/*Close tab with alt + w*/ document.addEventListener("keydown", (e) => {
  if (e.key === "w" && e.altKey) {
    parent.closeTab();
  }
});
/*Open new tab with alt + T */ document.addEventListener("keydown", (e) => {
  if (e.key === "t" && e.altKey) {
    parent.closeTab();
  }
});
