import toast from "@t007/toast";
import * as tmg from "tmg-media-player/super";
import { IndexedDBAdapter, LocalStorageAdapter } from "sia-reactor/modules";
import { defaults } from "./consts";

// Global Adapters

window.DB = new IndexedDBAdapter({
  dbName: "TVP_Sessions",
  version: 2,
  debug: true,
  stores: ["handles", "subtitles", "chapters"],
  onidb() {
    if (!canSession) throw new Error("TVP Session Persistence is not needed here");
  },
  onversionchange: () => (toast.info(`TVP updated in another ${matchMedia("(display-mode: standalone)").matches ? "window" : "tab"}. Reloading...`), location.reload()),
  onblocked: () => toast.warn(`Please close other ${matchMedia("(display-mode: standalone)").matches ? "windows" : "tabs"} of TVP to apply updates`),
});

window.Memory = {
  adapter: (defaults["settings.persist"].adapter = new LocalStorageAdapter({ key: _lssk })),
  expiryDays: 70 * 7,
  getState() {
    return this.adapter.get();
  },
  async getSession() {
    const state = this.getState(),
      session = await DB.get("last_handles");
    if (!state?.config?.playlist?.content || (!session && !state.config.playlist.content.some((i) => !i.media.intent.src.startsWith("blob:")))) return null;
    console.log("🎞 TVP found a session:", state, session);
    const lastUpdated = session?.lastUpdated || Date.now();
    return (Date.now() - lastUpdated) / (1000 * 60 * 60 * 24) > this.expiryDays ? (await this.clearSession(), console.log("🎞 TVP cleaned up expired session.")) : { state, handles: session?.handles || [], lastUpdated };
  },
  async saveHandles() {
    const state = this.getState();
    sessionHandles?.length || state?.config.playlist.content?.some((i) => !i.media.intent.src.startsWith("blob:")) ? await DB.set("last_handles", { handles: sessionHandles, lastUpdated: Date.now() }) : await this.clearSession();
  },
  async clearSession() {
    await this.adapter.set(_lssk, { config: { settings: this.getState()?.config.settings || {} } });
    (window.sessionHandles = []), await DB.clear();
  },
  async clearSettings() {
    const state = this.getState();
    await this.adapter.set(_lssk, (delete state.config.settings, delete state.config.actions, state));
    localStorage.removeItem(tmg.consts.FN_KEY);
  },
};

// VN -> VN+1 MIGRATION LAYER
const prevGet = Memory.adapter.get.bind(Memory.adapter);
Memory.adapter.get = function (key, reviver) {
  let state = prevGet(key, reviver);
  if ((state?.playlist && !state.config) || Array.isArray(state?.config?.playlist)) toast.promise(tmg.utils.mockAsync(2500), { pending: "Applying latest updates...", success: "Your session data was cleared due to recent updates.", position: "bottom-left" }), (state = null), this.remove(key), setColors();
  if ((localStorage[_lsvk] || 0) < SV) state?.config && (toast.promise(tmg.utils.mockAsync(2500), { pending: "Applying latest updates...", success: "Your settings were reset due to recent updates.", position: "bottom-left" }), delete state.config.settings, delete state.config.actions, delete state.config.devMode, this.set(key, state), localStorage.removeItem(tmg.consts.FN_KEY), setColors()), (localStorage[_lsvk] = SV);
  if (state?.config?.lightState) (state.config.light = state.config.lightState), delete state.config.lightState;
  return state;
};

window.sessionPromise = Memory.getSession();
