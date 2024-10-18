export class HistoryHelper {
    constructor(user, dbName) {
      this.user = user ?? "shadow";
      this.dbName = dbName ?? "history";
      this.storeName = `${this.user}-history`
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

    }

    async setOpen(arr) {
      try {
        const db = await this.dbPromise;
        const oldValue = await this.get(key);
        return new Promise((resolve, reject) => {
          const transaction = db.transaction([this.storeName], "readwrite");
          const store = transaction.objectStore(this.storeName);
          const request = store.put(value, key);
          request.onsuccess = () => {
            resolve();
          };
          request.onerror = (e) => {
            reject(e.target.error);
          };
        });
      } catch (error) {
        console.error("Error setting value:", error);
      }
    }

    async add(key, value) {
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
              }
            });
            window.dispatchEvent(event);
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