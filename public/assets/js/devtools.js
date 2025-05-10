function devtoolToggle() {
  if (toggleState) {
    eruda.hide();
    eruda.destroy();
  } else {
    var script = document.createElement("script");
    script.src = "//cdn.jsdelivr.net/npm/eruda";
    document.body.appendChild(script);
    script.onload = function () {
      eruda.init();
      eruda.show();
    };
  }
  toggleState = !toggleState;
}
