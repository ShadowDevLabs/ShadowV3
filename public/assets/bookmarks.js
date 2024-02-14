class Bookmarks {
    constructor() {
        this.bookmarks = [] //Init the array
        this.container = document.getElementById("bookmarks-container") //Container for bookmarks (Under omnibox/searchbar)
        this.load(); //Start loading
    }
    load() {
        this.container.children.forEach(i => {i.remove()}); //Delete current bookmarks just in case
        this.bookmarks = JSON.parse(localStorage.getItem("bookmarks")); //Set bookmarks from localStorage (Array of objects)
        this.bookmarks.forEach(i => {this.new(i["url"], i["title"])}); //Create a bookmark for each one loaded up here ^^^
    }
    new(i, a) {
        //i: Url
        //a: Title

        //Create and setup the bookmark element (And sub-elements)
        function createBookmarkElem(url, title) {
            const bookmark = document.createElement("div");
            bookmark.className = "bookmark";
            bookmark.setAttribute("data-url", url);
            bookmark.setAttribute("data-title", title);
            const icon = document.createElement("i");
            icon.className = "fas fa-bookmark";
            const text = document.createElement("span");
            text.textContent = title;
            bookmark.appendChild(icon);
            bookmark.appendChild(text);
            this.container.appendChild(bookmark);
            return bookmark;
        }

        const bookmarkObj = {
            url: i,
            title: a,
            elem: createBookmarkElem(url, title)
        }

        this.bookmarks.push(bookmarkObj);
        bookmarkObj.elem.addEventListener("click", function(e) {
            if(e.shiftKey) {
                tabs.createTab(bookmarkObj.url);
            } else {
                tabs.loadTab(bookmarkObj.url);
            }
        });
        bookmarkObj.elem.addEventListener("contextmenu", function(e){
            this.showContextMenu(e);
        })
    }

    delete(i/*Either the bookmark object, or the name + url as an array*/) {
        if(typeof i === "Object") {
            this.bookmarks.splice(this.bookmarks.findIndex(i), 1); //Delete object from array
            i.elem.remove(); //Remove element from page
        } else {
            switch(typeof i) {
                case "Array":
                    this.bookmarks.forEach(a => {
                        if(a.url === i[0] && a.title === i[1]) {
                            //If url and title from array are found in bookmarks, remove them 
                            this.bookmarks.splice(this.bookmarks.findIndex(a), 1);
                            a.elem.remove();
                        }
                    })
                    break;
                case "String":
                    this.bookmarks.forEach(a => {
                        if(a.url === i) {
                            //If only provided with title, delete bookmarks with the title 
                            this.bookmarks.splice(this.bookmarks.findIndex(a), 1);
                            a.elem.remove();
                        } else if(a.title === i) {
                            //If only provided with title, delete bookmarks with the title
                            this.bookmarks.splice(this.bookmarks.findIndex(a), 1);
                            a.elem.remove();
                        }
                    })
                    break;
                default: 
                    console.log("Unknown type when deleting bookmark");
                    break;
            }
        } 
    }

    showContextMenu(e) {
        const menu = document.getElementById("bookmarks-context-menu");
        if(e.target.className === "bookmark") {
            e.preventDefault()
            menu.style.left = `${e.clientX}px`;
            menu.style.top = `${e.clientY}px`;
            menu.setAttribute("hidden", false);
        } else {
            menu.setAttribute("hidden", true)
        }
    }
}