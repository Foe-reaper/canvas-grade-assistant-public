'use strict';
chrome.action.onClicked.addListener(async tab => {
  if (!tab.id) return;
  await chrome.tabs.create({url: chrome.runtime.getURL('dashboard.html') + '?target=' + tab.id});
});
