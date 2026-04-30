import './style.css';
import { App } from './galaxy/app';
import { StartScreen, mountChangeProfileLink } from './start-screen';
import { clearSession, loadSession, saveSession, type SessionConfig } from './multiplayer/profile';
import {
  clearPortalUrlParams,
  mountReturnPortal,
  parseIncomingPortal,
  sessionFromPortal,
} from './portal';
import { startMusic } from './audio/music';
import { mountSettings } from './audio/settings-modal';

const host = document.getElementById('app') as HTMLDivElement | null;
if (!host) throw new Error('#app container not found');

// Boot order:
// 1. If the URL says we arrived through the Vibe Jam webring (`?portal=true`),
//    build a SessionConfig from those params, save it, strip the URL, and
//    skip straight into the app — incoming travellers shouldn't have to fill
//    out a profile picker just to land in our galaxy.
// 2. Otherwise, if a SessionConfig is already persisted, jump in.
// 3. Otherwise show the StartScreen.
//
// The "↻ change profile" link clears the saved session and reloads, which
// brings the StartScreen back without the App needing teardown logic.

const incoming = parseIncomingPortal();
if (incoming) {
  const config = sessionFromPortal(incoming);
  saveSession(config);
  clearPortalUrlParams();
  launch(config);
} else {
  const remembered = loadSession();
  if (remembered) {
    launch(remembered);
  } else {
    const screen = new StartScreen(host, (config) => {
      saveSession(config);
      screen.dispose();
      launch(config);
    });
    screen.mount();
  }
}

function launch(config: SessionConfig): void {
  new App(host!, config);
  if (config.portalRef) {
    mountReturnPortal(host!, config.portalRef);
  }
  mountChangeProfileLink(host!, () => {
    clearSession();
    window.location.reload();
  });
  // Audio: settings gear (bottom-right) + background music. Music waits for
  // the first user gesture before actually playing (browser autoplay policy);
  // wiring it up here means it's ready the moment the player clicks anywhere.
  mountSettings(host!);
  startMusic();
}
