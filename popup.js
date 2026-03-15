(() => {
  const statusEl = document.getElementById('status');
  const disableBtn = document.getElementById('toggleDisabled');
  const toggleBtn = document.getElementById('togglePanel');
  const clearBtn = document.getElementById('clearComments');

  function sendMessage(action) {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tab = tabs[0];
        if (!tab || !tab.url || !tab.url.includes('gemini.google.com')) {
          statusEl.textContent = 'Not on gemini.google.com';
          disableBtn.disabled = true;
          toggleBtn.disabled = true;
          clearBtn.disabled = true;
          resolve(null);
          return;
        }
        chrome.tabs.sendMessage(tab.id, { action }, response => {
          if (chrome.runtime.lastError) {
            statusEl.textContent = 'Extension not loaded on this page. Try refreshing.';
            resolve(null);
          } else {
            resolve(response);
          }
        });
      });
    });
  }

  function updateDisableBtn(disabled) {
    disableBtn.textContent = disabled ? 'Enable Commenting' : 'Disable Commenting';
  }

  async function updateStatus() {
    const state = await sendMessage('getState');
    if (state) {
      const n = state.commentCount;
      if (state.disabled) {
        statusEl.textContent = 'Commenting disabled';
      } else {
        statusEl.textContent = n === 0
          ? 'No comments yet'
          : `${n} comment${n === 1 ? '' : 's'}`;
      }
      updateDisableBtn(state.disabled);
    }
  }

  disableBtn.addEventListener('click', async () => {
    const result = await sendMessage('toggleDisabled');
    if (result) updateDisableBtn(result.disabled);
    updateStatus();
  });

  toggleBtn.addEventListener('click', async () => {
    await sendMessage('togglePanel');
    updateStatus();
  });

  clearBtn.addEventListener('click', async () => {
    if (confirm('Clear all comments for this conversation?')) {
      await sendMessage('clearComments');
      updateStatus();
    }
  });

  updateStatus();
})();
