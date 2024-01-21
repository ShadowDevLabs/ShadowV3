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
        const bookmark = document.createElement("div");
        bookmark.className = "bookmark";
        bookmark.setAttribute("data-url", i);
        bookmark.setAttribute("data-title", a);
        const icon = document.createElement("i");
        icon.className = "fas fa-bookmark";
        const text = document.createElement("span");
        text.textContent = title;
        bookmark.appendChild(icon);
        bookmark.appendChild(text);
        this.container.appendChild(bookmark)
    }
    delete(i/*Either the bookmark object, or the name + url as an array*/) {
        if(typeof i === "Object") {
            
            i.remove();
        } else {
            //Find bookmark
        } 
    }
}