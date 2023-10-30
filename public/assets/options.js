function settingoptions() {
    var iframeContainer = document.createElement('div');
    iframeContainer.setAttribute('id', 'iframeContainer');
    iframeContainer.style.display = 'flex';
    iframeContainer.style.position = 'fixed';
    iframeContainer.style.top = '0';
    iframeContainer.style.left = '0';
    iframeContainer.style.width = '100%';
    iframeContainer.style.height = '100%';
    iframeContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    iframeContainer.style.zIndex = '9999';

    var iframeBox = document.createElement('div');
    iframeBox.setAttribute('id', 'iframeBox');
    iframeBox.style.position = 'relative';
    iframeBox.style.margin = 'auto';
    iframeBox.style.width = '90%';
    iframeBox.style.height = '80%';
    iframeBox.style.backgroundColor = 'none';
    iframeBox.style.border = '1px solid #ccc';
    iframeBox.style.borderRadius = '5px';
    iframeBox.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';

    var closeButton = document.createElement('i');
    closeButton.innerHTML = '<i class="fa-solid fa-x fa-lg" style="color: #f40b0b;"></i>';
    closeButton.style.position = 'absolute';
    closeButton.style.top = '2px';
    closeButton.style.right = '10px';
    closeButton.style.padding = '5px 10px';
    closeButton.style.border = 'none';
    closeButton.style.cursor = 'pointer';
    closeButton.onclick = function() {
        document.body.removeChild(iframeContainer);
    };

    var iframe = document.createElement('iframe');
    iframe.setAttribute('src', '/settings/');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('width', '100%');
    iframe.setAttribute('height', '100%');

    iframeBox.appendChild(closeButton);
    iframeBox.appendChild(iframe);
    iframeContainer.appendChild(iframeBox);

    document.body.appendChild(iframeContainer);
    
}

function openNewTab() {
    const url = location.href;
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    let inFrame;
    
    try {
      inFrame = window !== top;
    } catch (e) {
      inFrame = true;
    }
    
    if (!inFrame && !navigator.userAgent.includes("Firefox")) {
      const popup = window.open("about:blank", name, `width=${width},height=${height}`);
    
      if (!popup || popup.closed) {
        alert("Allow popups and redirects to hide this from showing up in your history.");
      } else {
        const doc = popup.document;
        const iframe = doc.createElement("iframe");
        const style = iframe.style;
        const link = doc.createElement("link");
    
    
        iframe.src = url;
        style.position = "fixed";
        style.top = style.bottom = style.left = style.right = 0;
        style.border = style.outline = "none";
        style.width = style.height = "100%";
    
        doc.head.appendChild(link);
        doc.body.appendChild(iframe);
        window.location.replace("https://google.com");
      }
    }
  }