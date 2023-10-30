document.addEventListener("DOMContentLoaded", (event) => {
    let tabCount = 1;
    const tabsContainer = document.querySelector('.tabs');
    const tabPanelsContainer = document.querySelector('.tab-panels');
    const addTabBtn = document.getElementById('add-tab-btn');
    const closeTabBtn = document.getElementById('closetabbtn');
    const iframeControl = document.querySelector('.iframe-control');
    const inputField = document.querySelector('input');
    const backBtn = document.querySelector('.back-btn');
    const refreshBtn = document.querySelector('.refresh-btn');
    const forwardBtn = document.querySelector('.forward-btn');
    const bookmarkBtn = document.getElementById('bookmark-btn');
    let currentTabPanelId = null;

    function switchTab(event) {
        const target = event.target;
        if (target === addTabBtn) {
            addTab();
        } else if (target.classList.contains('close-tab-btn')) {
            const tabPanel = target.closest('li').getAttribute('data-panel');
            closeTabByPanelId(tabPanel);
        } else {
            const tabPanel = target.closest('li').getAttribute('data-panel');
            showTab(tabPanel);
        }
    }

    function addTab(title, src) {
        const newTabId = `tab${tabCount}`;
        const newTabPanelId = `panel${tabCount}`;

        document.querySelectorAll('.tabs li').forEach(tab => {
            tab.classList.remove('active');
        });

        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.remove('active');
        });

        const newTab = document.createElement('li');
        newTab.setAttribute('data-panel', newTabPanelId);
        newTab.classList.add('active');
        newTab.innerHTML = `${title} <span class="close-tab-btn">X</span>`;
        tabsContainer.appendChild(newTab);

        const newTabPanel = document.createElement('div');
        newTabPanel.setAttribute('data-src', src);
        newTabPanel.classList.add('tab-panel', 'active');
        newTabPanel.setAttribute('id', newTabPanelId);
        newTabPanel.innerHTML = `<iframe src="${src}" frameborder="0"></iframe>`;
        tabPanelsContainer.appendChild(newTabPanel);

        tabCount++;
        resizeTabs();

        const iframe = newTabPanel.querySelector('iframe');
        updateTabTitleFromIframe(iframe);
        iframe.addEventListener('load', function () {
            updateTabTitleFromIframe(iframe);
        });
    }
    addTab('<i class="fa-solid fa-house"></i> Home', "home.html");

    function closeTab(event) {
        const closeBtn = event.target;
        if (closeBtn.classList.contains('close-tab-btn')) {
            const tabPanelId = closeBtn.parentElement.getAttribute('data-panel');
            closeTabByPanelId(tabPanelId);
        }
    }
    
    function showTab(panelId) {
        document.querySelectorAll('.tabs li').forEach(tab => {
            tab.classList.remove('active');
        });

        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.remove('active');
        });

        const tabToActivate = document.querySelector(`.tabs li[data-panel="${panelId}"]`);
        const tabPanelToActivate = document.querySelector(`#${panelId}`);
        if(tabToActivate != null) tabToActivate.classList.add('active');
        if(tabPanelToActivate != null) tabPanelToActivate.classList.add('active');
        currentTabPanelId = panelId;
    }

    function closeTabByPanelId(panelId) {
        const tabToRemove = document.querySelector(`[data-panel="${panelId}"]`);
        const tabPanelToRemove = document.getElementById(panelId);

        localStorage.removeItem(`${panelId}-input`);

        tabPanelToRemove.remove();
        tabToRemove.remove();

        const newActiveTabPanel = document.querySelector('.tab-panel.active');
        if (newActiveTabPanel) {
            showTab(newActiveTabPanel.getAttribute('id'));
        } else {
            const lastTabPanel = document.querySelector('.tab-panel:last-child');
            if (lastTabPanel) {
                showTab(lastTabPanel.getAttribute('id'));
            } else {
                const newTabMessage = document.createElement('div');
                newTabMessage.classList.add('new-tab-message');
                newTabMessage.textContent = 'Open a new tab to continue';
                tabPanelsContainer.appendChild(newTabMessage);
            }
        }

        resizeTabs();
    }

    function saveInputs(panelId) {
        const iframe = document.querySelector(`#${panelId} iframe`);
        if(iframe != null) var inputs = iframe.contentDocument.querySelectorAll('input, textarea');

        if(inputs != null){
            inputs.forEach(input => {
                const savedValue = localStorage.getItem(`${panelId}-${input.name}`);
                input.value = savedValue || '';

                input.addEventListener('input', function () {
                    localStorage.setItem(`${panelId}-${input.name}`, input.value);
                });
            });
        }
    }

    function updateTabTitleFromIframe(iframe) {
        const activeTab = document.querySelector('.tabs li.active');
        if (activeTab) {
            const src = iframe.src;
            const encodedurl = src.split('/uv/service/')[1];
            const decodedsrc = __uv$config.decodeUrl(encodedurl);
            const imgsrc=`https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${decodedsrc}&size=24`
            const faviconsrc = `<img style="margin-right: 1px;" src="${imgsrc}">`;
            if (src.includes('home.html') || src.includes('main.html')) {
            } else { 
                const iframeTitle = `<span style="margin-left: 1px;" class="tabname">${iframe.contentDocument.title}</span>`;
                activeTab.innerHTML = `${faviconsrc} ${iframeTitle} <span class="close-tab-btn">&#xf00d;</span>`;
            }
        }
        iframe.addEventListener('load', function () {
            updateTabTitleFromIframe(iframe);
        });
        iframe.contentWindow.addEventListener('beforeunload', function () {
            iframe.dataset.lastTitle = iframe.contentDocument.title;
        });
        iframe.contentWindow.addEventListener('unload', function () {
            if (iframe.dataset.lastTitle) {
                iframe.contentDocument.title = iframe.dataset.lastTitle;
                iframe.dataset.lastTitle = '';
                updateTabTitleFromIframe(iframe);
            }
        });
    }

    function resizeTabs() {
        const tabWidth = 100; 
        const totalTabs = tabsContainer.childElementCount;
        const availableWidth = tabsContainer.offsetWidth;
        const maxVisibleTabs = Math.floor(availableWidth / tabWidth);
        const visibleTabs = Math.min(maxVisibleTabs, totalTabs);

        const newTabWidth = `${100 / visibleTabs}%`;
        tabsContainer.querySelectorAll('.tabs li').forEach(tab => {
            tab.style.width = newTabWidth;
        });
    }

    tabsContainer.addEventListener('click', switchTab);
    addTabBtn.addEventListener('click', function () {
        addTab('<i class="fas fa-globe"></i> New Tab', "main.html");
    });

    if(closeTabBtn)closeTabBtn.addEventListener('click', closeTab);
    document.addEventListener('keydown', e => {if (e.key === 'w' && e.altKey){closeTab;}});

    backBtn.addEventListener('click', function () {
        const iframe = document.querySelector(`#${currentTabPanelId} iframe`);
        iframe.contentWindow.history.back();
    });

    refreshBtn.addEventListener('click', function () {
        const iframe = document.querySelector(`#${currentTabPanelId} iframe`);
        iframe.contentWindow.location.reload();
    });

    forwardBtn.addEventListener('click', function () {
        const iframe = document.querySelector(`#${currentTabPanelId} iframe`);
        iframe.contentWindow.history.forward();
    });


    window.addEventListener('resize', function () {
        resizeTabs();
    });

    function isOverflowing(container, element) {
        return container.scrollWidth > container.clientWidth || element.offsetTop > container.clientHeight;
    }

    function addBookmarkToLocalStorage(title, link) {
        const bookmarks = JSON.parse(localStorage.getItem('bookmarks')) || [];
        const isDuplicate = bookmarks.some((bookmark) => bookmark.title === title && bookmark.link === link);
        if (!isDuplicate) {
            bookmarks.push({ title, link });
            localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
        }
    }

    function addBookmark(title, link) {
        const bookmarksContainer = document.getElementById('bookmarks-panel');
        const bookmarksOverflow = document.getElementById('bookmarks-overflow');

        const bookmark = document.createElement('a');

        if (link.startsWith(window.location.origin)) {
            link = link.substring(window.location.origin.length);
        }

        if (link.includes('main.html') || link.includes('home.html') || link.includes('/settings/')) {
            if (link.includes('home.html')) {
                bookmark.innerHTML = "<i class='fa-solid fa-house'>  </i> " + " " +  title;
            }
            if (link.includes('main.html')) {
                bookmark.innerHTML = '<i class="fas fa-globe"> </i>  ' + " " +  title;
            }
            if (link.includes('/settings/')) {
                bookmark.innerHTML = '<i class="fa-sharp fa-solid fa-gear"> </i> ' + " " +  title;
            }
        } else {
            const decodedlink = link;
            const imgsrc = `/icons/www.png`;
            const faviconlink = `<img style="margin-right: 5px;" src="${imgsrc}">`;
            bookmark.innerHTML = faviconlink + title;
            const encodedlink = `/uv/service/` + __uv$config.encodeUrl(link);
            bookmark.setAttribute('onclick', `changeTabSrc('${encodedlink}')`);
        }

        bookmark.classList.add('bookmark-item');
        bookmark.addEventListener('click', (event) => {
            event.preventDefault();
            const activeTabPanel = document.querySelector('.tab-panel.active');
            const iframe = activeTabPanel.querySelector('iframe');
        });

        bookmark.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            showContextMenu(bookmark, title, link, event);
        });

        if (isOverflowing(bookmarksContainer, bookmark)) {
            bookmarksOverflow.appendChild(bookmark);
            bookmarksOverflow.classList.add('show');
        } else {
            bookmarksContainer.appendChild(bookmark);
        }

        addBookmarkToLocalStorage(title, link);
    }

    function showContextMenu(bookmarkElement, title, link, event) {
        if (document.querySelector('.context-menu')) {
            return;
        }

        const contextMenu = document.createElement('div');
        contextMenu.classList.add('context-menu');

        const deleteOption = document.createElement('div');
        deleteOption.textContent = 'Delete Bookmark';
        deleteOption.addEventListener('click', () => {
            deleteBookmark(bookmarkElement, link);
            contextMenu.remove();
        });
        contextMenu.appendChild(deleteOption);

        contextMenu.style.position = 'absolute';
        contextMenu.style.top = `${event.clientY}px`;
        contextMenu.style.left = `${event.clientX}px`;

        contextMenu.dataset.visible = 'true';

        document.body.appendChild(contextMenu);

        const closeContextMenu = (event) => {
            if (contextMenu && contextMenu.dataset.visible === 'true' && !contextMenu.contains(event.target)) {
                contextMenu.style.display = 'none';
                document.removeEventListener('click', closeContextMenu);
            }
        };

        document.addEventListener('click', closeContextMenu);

        event.preventDefault();
    }

    function deleteBookmark(bookmarkElement, link) {
        bookmarkElement.remove();
        const bookmarks = JSON.parse(localStorage.getItem('bookmarks')) || [];
        const updatedBookmarks = bookmarks.filter((bookmark) => bookmark.link !== link);
        localStorage.setItem('bookmarks', JSON.stringify(updatedBookmarks));
    }

    function showBookmarkPopup() {
        const popup = document.getElementById('bookmark-popup');
        popup.style.display = 'block';

        const activeTabPanel = document.querySelector('.tab-panel.active');
        const iframe = activeTabPanel.querySelector('iframe');
        const bookmarkLinkInput = document.getElementById('bookmark-link-input');
        const bookmarkTitleInput = document.getElementById('bookmark-title-input');
        let defaultlink = iframe.src;
        if (defaultlink.includes('/uv/service/')) {
            defaultlink = defaultlink.substring(defaultlink.indexOf('/uv/service/') + '/uv/service/'.length);
            defaultlink = __uv$config.decodeUrl(defaultlink);
        }
        bookmarkLinkInput.value = defaultlink;
        bookmarkTitleInput.value = iframe.contentDocument.title; 

        const bookmarkConfirmBtn = document.getElementById('bookmark-confirm');
        bookmarkConfirmBtn.removeEventListener('click', handleBookmarkConfirm);
        bookmarkConfirmBtn.addEventListener('click', handleBookmarkConfirm);

        const bookmarkCancelBtn = document.getElementById('bookmark-cancel');
        bookmarkCancelBtn.removeEventListener('click', handleBookmarkCancel); 
        bookmarkCancelBtn.addEventListener('click', handleBookmarkCancel);
    }

    function handleBookmarkConfirm() {
        const bookmarkTitleInput = document.getElementById('bookmark-title-input');
        const bookmarkLinkInput = document.getElementById('bookmark-link-input');
        const bookmarkTitle = bookmarkTitleInput.value;
        const bookmarkLink = bookmarkLinkInput.value;
        addBookmark(bookmarkTitle, bookmarkLink);

        const popup = document.getElementById('bookmark-popup');
        popup.style.display = 'none';
    }

    function handleBookmarkCancel() {
        const popup = document.getElementById('bookmark-popup');
        popup.style.display = 'none';
    }

    bookmarkBtn.addEventListener('click', showBookmarkPopup);

    function createBookmarks() {
        const bookmarks = JSON.parse(localStorage.getItem('bookmarks')) || [];

        bookmarks.forEach((bookmark) => {
            addBookmark(bookmark.title, bookmark.link);
        });
    }

    document.addEventListener('DOMContentLoaded', createBookmarks);

    function updatefaviconagain() {
        const activeTabPanel = document.querySelector('.tab-panel.active');
        if (activeTabPanel) {
            const iframe = activeTabPanel.querySelector('iframe');
            updateTabTitleFromIframe(iframe);
        }
    }

    function calculateServerPing(serverURL) {
        const beaconData = 'ping-test';
        const startTime = performance.now();
        navigator.sendBeacon(serverURL, beaconData);
        const endTime = performance.now();
        const pingTime = endTime - startTime;
        const pingResultElement = document.getElementById('pingResult');
        alert(`Average ping to ${serverURL}: ${pingTime.toFixed(2)} ms`);
    }


    function changeTabSrc(src) {
        const activeTabPanel = document.querySelector('.tab-panel.active');
        if (activeTabPanel) {
            const iframe = activeTabPanel.querySelector('iframe');
            iframe.src = src;
        }
    }
});


function changeTabSrc(src) {
    const activeTabPanel = document.querySelector('.tab-panel.active');
    if (activeTabPanel) {
        const iframe = activeTabPanel.querySelector('iframe');
        iframe.src = src;
    }
}
