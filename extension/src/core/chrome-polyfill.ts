// ─── Chrome Extension API Polyfill for Web Development ───

export function setupChromePolyfill() {
  if (typeof window === 'undefined') return;

  if (!window.chrome) {
    (window as any).chrome = {};
  }

  const chrome = (window as any).chrome;

  if (!chrome.storage) {
    chrome.storage = {
      local: {
        get: (keys: string[] | string | null, callback?: (items: { [key: string]: any }) => void) => {
          const result: Record<string, any> = {};
          if (Array.isArray(keys)) {
            keys.forEach((k) => {
              const val = localStorage.getItem(k);
              if (val) {
                try {
                  result[k] = JSON.parse(val);
                } catch {
                  result[k] = val;
                }
              }
            });
          } else if (typeof keys === 'string') {
            const val = localStorage.getItem(keys);
            if (val) {
              try {
                result[keys] = JSON.parse(val);
              } catch {
                result[keys] = val;
              }
            }
          }
          if (callback) callback(result);
          return Promise.resolve(result);
        },
        set: (items: Record<string, any>, callback?: () => void) => {
          Object.entries(items).forEach(([k, v]) => {
            localStorage.setItem(k, JSON.stringify(v));
          });
          if (callback) callback();
          return Promise.resolve();
        },
        remove: (keys: string | string[], callback?: () => void) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          arr.forEach((k) => localStorage.removeItem(k));
          if (callback) callback();
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener: () => {},
        removeListener: () => {},
      },
    };
  }

  if (!chrome.runtime) {
    chrome.runtime = {
      sendMessage: () => Promise.resolve(),
      onMessage: {
        addListener: () => {},
        removeListener: () => {},
      },
      getURL: (path: string) => path,
    };
  }

  if (!chrome.tabs) {
    chrome.tabs = {
      query: () => Promise.resolve([{ url: window.location.href, active: true }]),
      onActivated: { addListener: () => {} },
      onUpdated: { addListener: () => {} },
    };
  }
}
