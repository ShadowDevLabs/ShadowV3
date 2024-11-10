(async function () {
    const text = !await window.settings.get("history") ? "Enable your history to begin!" : "Start by searching something!";
    const savedHistory = await self.history_helper.get();
    const historyData = Array.isArray(savedHistory) ? savedHistory : [{ time: Date.now(), title: `Nothings here yet! - ${text}`, url: "http://example.com", icon: "https://google.com/favicon.ico" }];
    historyData.forEach(data => add(data));
})();


function add(obj) {
    const dateContainer = document.querySelector(`[data-date="${getDay(new Date(obj.time))}"]`) ?? null;
    if (dateContainer) {
        dateContainer.children[1].appendChild(createItem(obj));
    } else {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const objDate = new Date(obj.time);

        const newDateContainer = document.createElement('div');
        newDateContainer.classList = "day-section";
        newDateContainer.dataset.date = getDay(objDate);

        const dayHeader = document.createElement('h2');
        const day = (objDate.toDateString() === today.toDateString()) ? "Today - " : (objDate.toDateString() === yesterday.toDateString()) ? "Yesterday - " : "";
        dayHeader.textContent = day + objDate.toLocaleDateString("default", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
        newDateContainer.prepend(dayHeader);

        const historyList = document.createElement("div");
        historyList.classList = "history-list";
        newDateContainer.append(historyList);
        historyList.prepend(createItem(obj));

        const entries = Array.from(document.querySelector("#historyEntries").children);
        if (entries.length > 0) {
            let previous = null;
            entries.forEach(elem => { if (new Date(elem.dataset.date).getTime() > obj.time) previous = elem });
            if (previous) {
                previous.after(newDateContainer);
            } else {
                document.querySelector("#historyEntries").prepend(newDateContainer);
            }
        } else {
            document.querySelector("#historyEntries").appendChild(newDateContainer);
        }
    }
}

function createItem(obj) {
    const item = document.createElement('div');
    item.classList.add('history-item');
    item.onclick = () => parent.tabs.load(obj.url);
    item.innerHTML = `
        <div class="history-info">
            <img src="${obj.icon}" class="favicon" alt="favicon">
            <div>
                <div class="history-title">${obj.title}</div>
                <div class="history-time">${new Date(obj.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
        </div>
        <!--<div class="history-actions">
            <input type="checkbox" class="select-item" data-link="${obj.url}">
        </div>-->
    `;
    return item;
}

function getDay(d) {
    d = new Date(d);
    return `${d.getDate()}-${d.getMonth()}-${d.getFullYear()}`;
}
