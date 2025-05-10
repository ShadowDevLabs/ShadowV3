class SettingsManager {
  constructor(user, dbName) {
    this.user = user || "shadow";
    this.dbName = dbName || "settingsDB";
    this.storeName = `${this.user}-settings` || "fluid-settings";
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

  async default(key, value) {
    if (await this.get(key) === undefined) {
      this.set(key, value);
      return "set";
    } else {
      return "preset";
    }
  }

  async toggle(key) {
    const initialVal = await this.get(key);
    if (typeof initialVal === "boolean" || typeof initialVal === "undefined") {
      await this.set(key, !initialVal);
      return "Toggled";
    } else {
      return new TypeError(`Value at ${key} is not a boolean`);
    }
  }

  async set(key, value) {
    try {
      const db = await this.dbPromise;
      const oldValue = await this.get(key);
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], "readwrite");
        const store = transaction.objectStore(this.storeName);
        const request = store.put(value, key);
        request.onsuccess = () => {
          resolve();
          const event = new CustomEvent("settings", {
            bubbles: true,
            detail: {
              key: key,
              newValue: value,  // Updated here
              oldValue: oldValue,
              database: this.dbName,
              success: true,
            }
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


  async get(key) {
    try {
      const db = await this.dbPromise;
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName]);
        const store = transaction.objectStore(this.storeName);
        const request = store.get(key);
        request.onsuccess = (e) => {
          resolve(e.target.result);
        };
        request.onerror = (e) => {
          reject(e.target.error);
        };
      });
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

  async clear() {
    try {
      const db = await this.dbPromise;
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], "readwrite");
        const store = transaction.objectStore(this.storeName);
        const request = store.clear();
        request.onsuccess = () => {
          resolve();
        };
        request.onerror = (e) => {
          reject(e.target.error);
        };
      });
    } catch (error) {
      console.error("Error clearing store:", error);
    }
  }
}

export { SettingsManager };