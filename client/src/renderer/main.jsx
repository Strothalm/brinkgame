import { render } from 'preact';
import './styles/fonts.js';
import './styles/base.css';
import './styles/screens.css';
import './styles/game.css';
import './styles/themes.css';
import './styles/backgrounds.css';
import { S, useStore, closeModal } from './store.js';
import { bgUrl } from './backgrounds.js';
import { init } from './actions.js';
import { Toasts, Modal, Btn } from './ui/common.jsx';
import { Home, Servers, Browser } from './ui/home.jsx';
import { Room } from './ui/room.jsx';
import { SettingsScreen, SettingsModal } from './ui/settings.jsx';
import { PacksScreen } from './ui/packsui.jsx';
import { UserModal } from './ui/cams.jsx';
import { BoardPreview, ConsentModal, CatsModal } from './ui/lobby.jsx';
import { AnticheatLog } from './ui/anticheat.jsx';

function Confirm({ title, text, yes, action }) {
  return (
    <Modal
      title={title}
      footer={
        <>
          <span class="grow" />
          <Btn onClick={closeModal}>Abbrechen</Btn>
          <Btn
            kind="danger"
            onClick={() => {
              closeModal();
              action();
            }}
          >
            {yes}
          </Btn>
        </>
      }
    >
      <p>{text}</p>
    </Modal>
  );
}

function ModalHost() {
  const m = S.modal;
  if (!m) return null;
  switch (m.type) {
    case 'user': return <UserModal id={m.id} />;
    case 'settings': return <SettingsModal tab={m.tab} />;
    case 'preview': return <BoardPreview />;
    case 'cats': return <CatsModal packId={m.packId} />;
    case 'consent': return <ConsentModal />;
    case 'aclog': return <AnticheatLog />;
    case 'confirm': return <Confirm {...m} />;
    case 'custom': return m.render();
    default: return null;
  }
}

function Backdrop() {
  const bg = S.settings.bg;
  const url = bgUrl(bg);
  return (
    <div class="backdrop" aria-hidden="true">
      {url && <div class="bg-photo" style={{ backgroundImage: `url("${url}")`, filter: bg.blur ? `blur(${bg.blur}px)` : 'none', transform: bg.blur ? `scale(${1 + bg.blur / 120})` : 'none' }} />}
      {url && <div class="bg-dim" style={{ opacity: bg.dim / 100 }} />}
    </div>
  );
}

function App() {
  useStore();
  if (!S.ready) return <div class="screen center" />;
  let screen;
  switch (S.screen) {
    case 'servers': screen = <Servers />; break;
    case 'browser': screen = <Browser />; break;
    case 'room': screen = <Room />; break;
    case 'packs': screen = <PacksScreen />; break;
    case 'settings': screen = <SettingsScreen />; break;
    default: screen = <Home />;
  }
  return (
    <div class="app">
      <Backdrop />
      {screen}
      <ModalHost />
      <Toasts />
    </div>
  );
}

render(<App />, document.getElementById('app'));
init();
