(() => {
  const SOURCE = "wa-passkey-connector";

  function emit(type, data = {}) {
    window.postMessage({ source: SOURCE, type, ...data }, "*");
  }

  window.addEventListener("message", (event) => {
    const m = event.data;
    if (!m || m.target !== SOURCE) return;

    if (m.type === "PING") {
      emit("CONNECTOR_READY");
      return;
    }

    if (m.type === "RUN_PASSKEY_ASSERTION") {
      chrome.runtime.sendMessage(
        {
          type: "RUN_PASSKEY_ASSERTION",
          requestId: m.requestId,
          publicKey: m.publicKey,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            emit("PASSKEY_ASSERTION_RESULT", {
              requestId: m.requestId,
              error: chrome.runtime.lastError.message,
            });
            return;
          }

          emit("PASSKEY_ASSERTION_RESULT", {
            requestId: m.requestId,
            assertion: response?.assertion || null,
            error: response?.error || null,
          });
        }
      );
    }
  });

  emit("CONNECTOR_READY");
})();
