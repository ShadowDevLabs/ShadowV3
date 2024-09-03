const features = document.getElementsByClassName("feature");
features[0].addEventListener("click", function () {
  parent.document.getElementById("search-bar").select();
});

features[1].addEventListener("click", function () {
  parent.createTab("shadow://settings");
});

features[2].addEventListener("click", function () {
  parent.createTab("shadow://extensions");
});

features[4].addEventListener("click", function () {
  parent.createTab("https://newalgebra.com");
});
// ok wait why did we do it this way huh