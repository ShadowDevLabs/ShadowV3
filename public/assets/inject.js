// New injection code

const proxy = "uv"; // Setup for dynamic

if (proxy === "uv") {
    function genAutoLoad() {
        const defaultAutoInject = ["/assets/contextmenu.html", "/assets/context.js", "/css/context.css", "/assets/keybinds.js"];
        localStorage.setItem("autoInject", JSON.stringify(defaultAutoInject));
        console.log("Generated auto loading URLs " + JSON.parse(localStorage.getItem("autoInject")));
        return defaultAutoInject;
    }

    function autoLoad() {
        let autoLoad = JSON.parse(localStorage.getItem("autoInject")) || genAutoLoad();
        console.log(autoLoad);
        for (const url of autoLoad) {
            inject(url, "internal");
        }
    }

    function genUserUrls() {
        const defaultUserUrls = ["https://phantom.lol/main.js"];
        localStorage.setItem("userUrls", JSON.stringify(defaultUserUrls));
        return defaultUserUrls;
    }

    function initInject() {
        console.log("Initiated Injection");
        let userUrls = JSON.parse(localStorage.getItem("userUrls")) || genUserUrls();
        for (const url of userUrls) {
            console.log("Injected " + url + " as a user URL");
            inject(url, "external");
        }
    }
    //talk up here
    //Peak:
    //  NC:


    async function inject(url, type) {
            const activeTabElement = document.querySelector(".tab-panel.active iframe"); 
            console.log("Injection is starting\n" + activeTabElement); 
            const activeTab = activeTabElement.contentWindow;
                console.log(activeTab); 
                if (type === "external") {
                    console.log("Using API to inject " + url + "\n" + activeTab);
                    const startContent = getSiteAPI(url);
                    const fileType = startContent[1]; 
                    const content = startContent[0];
                    activeTab.inject(content, fileType);
                } else {
                    console.log("Using fetch to inject internal URL " + url + "\n" + activeTab);
                    const response = await fetch(url);
                    const content = await response.text();
                    const fileType = url.substring(url.lastIndexOf('.') + 1);
                    activeTab.inject(content, fileType);
            }
        }

    function getSiteAPI(url) {
        let siteContent;
        let fileType;
        fetch("164.152.107.106:3000", {
            method: 'GET',
            headers: {
                'url': url
            }
        }).then(res => {
            siteContent = res.body;
            console.log("Site content is " + siteContent);
            fileType = res.headers.get('File-Type');
            console.log("Filetype is " + fileType);
        });
        return [siteContent, fileType];
    }
} else {
    console.log("Using dynamic's built-in injection");
} // Setup for dynamic
