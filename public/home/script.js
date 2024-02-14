const features = document.getElementsByClassName("feature");
features[0].addEventListener("click", function(){
  parent.document.getElementById("search-bar").select();
})

features[1].addEventListener("click", function(){
  parent.createTab("shadow://settings");
})

features[2].addEventListener("click", function(){
  parent.createTab("shadow://extensions");
})

features[4].addEventListener("click", function(){
  parent.createTab("https://now.gg/play/roblox-corporation/5349/roblox");
})
