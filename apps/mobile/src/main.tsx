import { createRoot } from 'react-dom/client';
import { Preferences } from '@capacitor/preferences';
import { App } from './App.js';
import { projectPreferences } from './preferences.js';
import { createMobileStore } from './store.js';
import './styles.css';

const key = 'pkos.mobile.compat.preferences.v1';
const store = createMobileStore({ preferences: {
  async load() {
    const { value } = await Preferences.get({ key });
    return value ? JSON.parse(value) : null;
  },
  async save(value) {
    await Preferences.set({ key, value: JSON.stringify(projectPreferences(value)) });
  },
} });

createRoot(document.getElementById('root')!).render(<App store={store} />);
window.addEventListener('pagehide', () => store.suspend());
window.addEventListener('pageshow', event => { if (event.persisted) void store.resume(); });
