"use strict";

// Keep the toolbar action aligned with the user's saved launch preference.
// An empty popup enables action.onClicked, which lets the click itself remain
// the required Firefox user gesture for opening a sidebar.
const CONFIG_KEY = "converter_config_v10";
const LEGACY_CONFIG_KEYS = ["converter_config_v9"];
const POPUP_PATH = "popup.html";
const extensionApi = globalThis.browser ?? globalThis.chrome;
const RUN_COMMAND_MESSAGE = "converter:run-command";
const SURFACE_READY_MESSAGE = "converter:surface-ready";
const SHORTCUT_CAPTURE_MESSAGE = "converter:shortcut-capture";

let launchMode = "popup";
let pendingCommand = null;
let shortcutCaptureActive = false;

function normalizeLaunchMode(value) {
  return value === "sidebar" ? "sidebar" : "popup";
}

async function applyLaunchMode(mode) {
  launchMode = normalizeLaunchMode(mode);
  if (!extensionApi?.action?.setPopup) return;

  try {
    await extensionApi.action.setPopup({
      popup: launchMode === "sidebar" ? "" : POPUP_PATH
    });
  } catch (error) {
    console.warn("Could not apply the extension launch mode", error);
  }
}

async function restoreLaunchMode() {
  try {
    // Read the immediately preceding key too, so a saved sidebar preference
    // survives the first toolbar click after a configuration-schema upgrade.
    const stored = await extensionApi?.storage?.local?.get([CONFIG_KEY, ...LEGACY_CONFIG_KEYS]);
    const savedConfig = stored?.[CONFIG_KEY]
      ?? LEGACY_CONFIG_KEYS.map((key) => stored?.[key]).find(Boolean);
    await applyLaunchMode(savedConfig?.launchMode);
  } catch (error) {
    console.warn("Could not restore the extension launch mode", error);
    await applyLaunchMode("popup");
  }
}

function openSidebarFromAction() {
  if (!extensionApi?.sidebarAction?.open) return;
  try {
    // This listener only receives clicks when applyLaunchMode() has disabled
    // the action popup. Do not await before open(): Firefox accepts it only
    // while the toolbar click is still a user gesture.
    Promise.resolve(extensionApi.sidebarAction.open()).catch((error) => {
      console.warn("Could not open the sidebar", error);
    });
  } catch (error) {
    console.warn("Could not open the sidebar", error);
  }
}

async function openSurfaceForCommand() {
  try {
    if (launchMode === "sidebar" && extensionApi?.sidebarAction?.open) {
      await extensionApi.sidebarAction.open();
      return;
    }
    if (extensionApi?.action?.openPopup) {
      await extensionApi.action.openPopup();
      return;
    }
    if (extensionApi?.sidebarAction?.open) await extensionApi.sidebarAction.open();
  } catch (error) {
    console.warn("Could not open the extension for a keyboard command", error);
  }
}

async function runExtensionCommand(command) {
  pendingCommand = command;
  try {
    const response = await extensionApi?.runtime?.sendMessage?.({ type: RUN_COMMAND_MESSAGE, command });
    if (response?.handled) {
      pendingCommand = null;
      return;
    }
  } catch {
    // No popup or sidebar is active yet; open the preferred surface below.
  }
  await openSurfaceForCommand();
}

extensionApi?.action?.onClicked?.addListener(openSidebarFromAction);
extensionApi?.commands?.onCommand?.addListener((command) => {
  if (!shortcutCaptureActive) void runExtensionCommand(command);
});
extensionApi?.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes?.[CONFIG_KEY]) return;
  void applyLaunchMode(changes[CONFIG_KEY].newValue?.launchMode);
});
extensionApi?.runtime?.onMessage?.addListener((message) => {
  if (message?.type === SHORTCUT_CAPTURE_MESSAGE) {
    shortcutCaptureActive = Boolean(message.active);
    return undefined;
  }
  if (message?.type === SURFACE_READY_MESSAGE) {
    const command = pendingCommand;
    pendingCommand = null;
    return Promise.resolve({ command });
  }
  return undefined;
});
extensionApi?.runtime?.onStartup?.addListener(() => void restoreLaunchMode());
extensionApi?.runtime?.onInstalled?.addListener(() => void restoreLaunchMode());

void restoreLaunchMode();
