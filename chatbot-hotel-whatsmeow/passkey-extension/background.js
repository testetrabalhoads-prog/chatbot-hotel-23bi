function base64urlToBytes(value) {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function getWhatsAppTab() {
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    return tabs[0];
  }
  return await chrome.tabs.create({ url: "https://web.whatsapp.com/", active: true });
}

async function waitLoaded(tabId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 30000);

    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 1500);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 1200);
      }
    }).catch(() => {});
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "RUN_PASSKEY_ASSERTION") return;

  (async () => {
    const tab = await getWhatsAppTab();
    await waitLoaded(tab.id);

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: async (rawOptions) => {
        function b64urlToBuffer(value) {
          const pad = "=".repeat((4 - (value.length % 4)) % 4);
          const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + pad;
          const raw = atob(base64);
          const bytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          return bytes.buffer;
        }

        function bufferToB64url(buffer) {
          const bytes = new Uint8Array(buffer);
          let s = "";
          for (const b of bytes) s += String.fromCharCode(b);
          return btoa(s)
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/g, "");
        }

        const publicKey = {
          ...rawOptions,
          challenge: b64urlToBuffer(rawOptions.challenge),
          allowCredentials: (rawOptions.allowCredentials || []).map((c) => ({
            ...c,
            id: b64urlToBuffer(c.id),
          })),
        };

        const credential = await navigator.credentials.get({ publicKey });
        if (!credential) throw new Error("Nenhuma credencial retornada.");

        return {
          id: credential.id,
          rawId: bufferToB64url(credential.rawId),
          type: credential.type,
          response: {
            clientDataJSON: bufferToB64url(credential.response.clientDataJSON),
            authenticatorData: bufferToB64url(credential.response.authenticatorData),
            signature: bufferToB64url(credential.response.signature),
            userHandle: credential.response.userHandle
              ? bufferToB64url(credential.response.userHandle)
              : null,
          },
        };
      },
      args: [message.publicKey],
    });

    sendResponse({ assertion: result?.[0]?.result || null });
  })().catch((error) => {
    sendResponse({ error: error?.message || String(error) });
  });

  return true;
});
