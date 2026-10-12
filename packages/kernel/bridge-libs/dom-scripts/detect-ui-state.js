/**
 * Detect UI state: canSteer and isGenerating from DOM buttons.
 */
(function detectUiState() {
  const sendBtnSelectors = ['.send-button-container', '[class*="send"]', 'button[type="submit"]', '[aria-label*="send" i]'];
  let canSteer = false;
  for (const sel of sendBtnSelectors) {
    const btn = document.querySelector(sel);
    if (btn) {
      canSteer = !btn.disabled && !btn.className.includes('disabled') && btn.offsetParent !== null;
      if (canSteer) break;
    }
  }

  const stopBtnSelectors = ['.stop-button-container', '[class*="stop"]', '[class*="cancel"]', '[aria-label*="stop" i]'];
  let isGenerating = false;
  for (const sel of stopBtnSelectors) {
    const btn = document.querySelector(sel);
    if (btn && btn.offsetParent !== null) {
      isGenerating = true;
      break;
    }
  }
  if (!isGenerating && !canSteer) {
    const anySend = document.querySelector('.send-button-container, [class*="send"]');
    if (!anySend || anySend.offsetParent === null) isGenerating = true;
  }
  return { canSteer, isGenerating };
})();
