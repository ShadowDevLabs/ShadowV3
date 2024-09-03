var extLoaded;
if (typeof window != null) {
if (typeof window != null) {
  onload = init;


  function init() {
    loadExtensions();
    let tries;
    try {
      parent.updateOmni();
      parent.setTab();
    } catch (e) {
      if (tries <= 2) setTimeout(init, 2500);
      tries++;
    }
  }


  function loadExtensions() {
    if (!extLoaded) {
      try {
        const extensionController = new Extensions();

        extLoaded = true;
        console.log("Extensions loaded!");
        console.log(tag);
      } catch (e) {
        console.warn("Error loading extensions: ", e);
      }
    }
  }
}}
