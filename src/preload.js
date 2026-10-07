'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('shipnotes', {
  getSettings: call('settings:get'),
  saveSettings: call('settings:save'),
  loadRepo: call('repo:load'),
  writeNotes: call('notes:write'),
  saveFile: call('notes:save'),
  copyText: call('notes:copy'),
  createDraft: call('release:draft'),
  openExternal: call('open:external')
});
