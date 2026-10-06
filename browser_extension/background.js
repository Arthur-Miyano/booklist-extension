// 工具栏直接打开原生侧栏，不创建本地页面或独立窗口。
chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({windowId: tab.windowId}).catch(console.error);
  chrome.storage.session.set({[`source-${tab.windowId}`]: {tabId: tab.id, openedAt: Date.now()}}).catch(console.error);
});
