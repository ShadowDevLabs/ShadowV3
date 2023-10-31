document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("uv-form");
    const address = document.getElementById("uv-address");
    const searchEngine = document.getElementById("uv-search-engine");
    const error = document.getElementById("uv-error");
    const errorCode = document.getElementById("uv-error-code");
  
    const registerServiceWorker = registerSW().catch((err) => {
      error.textContent = "Failed to register service worker.";
      errorCode.textContent = err.toString();
      throw err;
    });

    window.addEventListener('load', async () => {
        await registerServiceWorker();
      });


    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        await registerServiceWorker;
        const url = search(address.value, "https://www.google.com/search?q=%s");
        localStorage.setItem("mainurl", url);
    });
});
  
  
  