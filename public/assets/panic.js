var panicKey = localStorage.getItem("chill");

if (panicKey == null) {
  panicKey = "1&Escape";
  localStorage.setItem("chill", panicKey);
}

var panicStart = panicKey.charAt(0);
var panicKeys = panicKey.substring(2).split("&");

document.addEventListener("keydown", (e) => {
  if (
    (panicStart === "1" && e.key === panicKeys[0]) ||
    (panicStart === "2" && e.key === panicKeys[0] && e[panicKeys[1] + "Key"])
  ) {
    activatePanic();
  }
});

function activatePanic() {
  location.href = localStorage.getItem("");
  console.log("close");
}
