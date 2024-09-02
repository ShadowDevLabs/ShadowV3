var selectedText;
var activeElement;
document.addEventListener("DOMContentLoaded", function () {
  var customMenu = document.getElementById("custom-menu");
  var body = document.getElementById("body");

  document.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    selectedText = window.getSelection().toString();
    activeElement = document.activeElement;
    customMenu.style.left = e.clientX + "px";
    customMenu.style.top = e.clientY + "px";
    customMenu.style.display = "block";
  });

  document.addEventListener("click", function (e) {
    customMenu.style.display = "none";
  });
});

function copy() {
  navigator.clipboard.writeText(selectedText);
}

function paste() {
  navigator.clipboard
    .readText()
    .then(function (text) {
      var pasteText = text;
      activeElement.value = activeElement.value + pasteText;
    })
    .catch(function (error) {
      console.error("Failed to read text from clipboard: ", error);
    });
  activeElement.focus();
}

function selectAll() {
  var selection = window.getSelection();
  var focusedElement = document.activeElement;

  if (
    focusedElement &&
    (focusedElement.tagName === "INPUT" ||
      focusedElement.tagName === "TEXTAREA")
  ) {
    // If focused element is an input field or textarea
    focusedElement.select();
  } else {
    // If focused element is not an input field or textarea
    var range = document.createRange();
    range.selectNodeContents(document.body);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

window.addEventListener("message", (e) => {
  if (e.origin !== location.origin) return;
  if (e.message === "click") {
    document.getElementsByClassName("context").forEach((i) => {
      if (
        i.getAttribute("hidden") === false ||
        i.className.includes("active")
      ) {
        i.hidden;
      }
    });
  }
});
