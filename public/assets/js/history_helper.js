class HistoryHelper {
  constructor(user, dbName) {
    this.user = user ?? "shadow";
    this.dbName = dbName ?? "history";
    this.storeName = `${this.user}-history`;
    this.dbPromise = this.initDB();
  }

  initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onerror = (e) => {
        console.error("Settings database error:", e.target.errorCode);
        reject(e.target.errorCode);
      };
    });
  }

  async getOpen() {
    return await this.get("open-tabs");
  }

  async setOpen(arr) {
    await this.set([...arr], "open-tabs");
  }

  /**
   * Adds a visit to the front of the list. Read and write happen in one
   * transaction, so two tabs finishing a page load at the same moment can't
   * overwrite each other's entry (and the list is only read once per visit).
   */
  async add(obj) {
    try {
      const db = await this.dbPromise;
      await new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], "readwrite");
        const store = transaction.objectStore(this.storeName);
        const read = store.get("history-array");
        read.onsuccess = () => {
          const arr = Array.isArray(read.result) ? read.result : [];
          // Reloading or bouncing back to the same page isn't a new visit.
          if (arr[0]?.url === obj.url && obj.time - (arr[0].time ?? 0) < 30000) {
            arr[0] = { ...arr[0], ...obj };
          } else {
            arr.unshift(obj);
          }
          // The whole list is rewritten on every visit, so keep it bounded.
          if (arr.length > 5000) arr.length = 5000;
          store.put(arr, "history-array");
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      self.dispatchEvent(new CustomEvent("historyupdate", { detail: { key: "history-array", database: this.dbName, success: true } }));
    } catch (error) {
      console.error("Error adding history entry:", error);
    }
  }

  async set(value, key = "history-array") {
    try {
      const db = await this.dbPromise;
      const oldValue = await this.get(key);
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], "readwrite");
        const store = transaction.objectStore(this.storeName);
        const request = store.put(value, key);
        request.onsuccess = () => {
          resolve();
          const event = new CustomEvent("historyupdate", {
            detail: {
              key: key,
              value: value,
              oldValue: oldValue,
              database: this.dbName,
              success: true,
            },
          });
          self.dispatchEvent(event);
        };
        request.onerror = (e) => {
          reject(e.target.error);
        };
      });
    } catch (error) {
      console.error("Error setting value:", error);
    }
  }

  async get(key = "history-array") {
    try {
      const db = await this.dbPromise;

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], "readonly");
        const store = transaction.objectStore(this.storeName);

        const request = store.get(key);
        request.onsuccess = (e) => {
          resolve(e.target.result);
        };
        request.onerror = (e) => {
          reject(e.target.error);
        };
      }
      );
    } catch (error) {
      console.error("Error getting value:", error);
    }
  }

  async remove(key) {
    try {
      const db = await this.dbPromise;
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], "readwrite");
        const store = transaction.objectStore(this.storeName);
        const request = store.delete(key);
        request.onsuccess = () => {
          resolve();
        };
        request.onerror = (e) => {
          reject(e.target.error);
        };
      });
    } catch (error) {
      console.error("Error removing value:", error);
    }
  }

  async clear(key) {
    try {
      const db = await this.dbPromise;
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], "readwrite");
        const store = transaction.objectStore(this.storeName);

        const getAllKeysRequest = store.getAllKeys();
        getAllKeysRequest.onsuccess = (e) => {
          let keysToDelete;
          const allKeys = e.target.result;
          if (!key) {
            keysToDelete = allKeys.filter(i => i !== "open-tabs");
          } else {
            keysToDelete = allKeys.filter(i => i === key)
          }
          localStorage.setItem("deleting", JSON.stringify(keysToDelete))
          keysToDelete.forEach(key => {
            store.delete(key);
          });

          resolve();
        };

        getAllKeysRequest.onerror = (e) => {
          reject(e.target.error);
        };
      });
    } catch (error) {
      console.error("Error clearing store:", error);
    }
  }
}

export { HistoryHelper };