import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import './ui/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { EMPTY_START } from './domain/menuEdits.ts';
import { SAMPLE_START, setStartingMenu } from './domain/menu.ts';
import { httpTransport, pairFromUrl, startSync, syncToken } from './services/syncClient.ts';
import { FAKE_RICE_START } from './fake/data.ts';
import { isDemo, isRiceDemo } from './ui/storage.ts';
import { setUpOwnerApp } from './services/ownerApp.ts';
import { loadShopDetails } from './services/shop.ts';
import { Root } from './ui/Root.tsx';
import { UpdateScreen } from './ui/UpdateScreen.tsx';
import { applyTheme } from './ui/theme.ts';

applyTheme(); // light, dark, or following the system: this screen's own choice
// A shop starts with an empty menu and builds its own, on the counter and in the cloud (the owner's phone,
// /admin): its own menu events are its whole menu. Only the demos use a ready menu.
setStartingMenu(isRiceDemo() ? FAKE_RICE_START : isDemo() ? SAMPLE_START : EMPTY_START);

// Sync starts only on a paired device (docs/server-setup.md); otherwise the app works on its own, as before.
pairFromUrl();
setUpOwnerApp(); // after pairing: the owner's key goes into the phone app's description
const token = syncToken();
if (token) startSync(httpTransport(token));
void loadShopDetails(); // the shop's own name for the corner and the receipt

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
    <UpdateScreen />
  </StrictMode>,
);
