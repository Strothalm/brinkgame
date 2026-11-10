import { useMemo, useState } from 'preact/hooks';
import { S, go, toast, openModal, closeModal, emit } from '../store.js';
import * as P from '../packs.js';
import { Btn, Icon, Field, Modal, Seg, Empty, Toggle } from './common.jsx';

const LEVEL_LABEL = ['', '100', '200', '300', '400', '500'];
const COLORS = ['#ff5a4e', '#ff8a3d', '#ffb224', '#f2e24b', '#7bd148', '#3ecf8e', '#18c8c8', '#3aa0ff', '#5b7cfa', '#b57bff', '#ff6fb5', '#9aa7b8'];

// ---------- library ----------

function PackTile({ pack, onEdit, refresh }) {
  const st = P.packStats(pack);
  return (
    <li class="lib-card" style={{ '--c': pack.color }}>
      <button type="button" class="lib-main" onClick={onEdit}>
        <span class="pack-icon">{pack.icon}</span>
        <span class="lib-text">
          <strong>{pack.name}</strong>
          <small>{pack.desc}</small>
        </span>
      </button>
      <div class="lib-meta">
        <span>{st.active}{st.active !== st.total ? ` von ${st.total}` : ''} Fragen</span>
        <span>{st.playable} Kategorien</span>
        {pack.builtin ? (pack.edited ? <span class="tag warn">angepasst</span> : <span class="tag">mitgeliefert</span>) : <span class="tag accent">eigenes Paket</span>}
      </div>
      <div class="lib-actions">
        <Btn size="sm" icon="edit" onClick={onEdit}>Bearbeiten</Btn>
        <Btn size="sm" icon="copy" kind="ghost" title="Als eigenes Paket kopieren" aria-label="Kopieren" onClick={() => { P.duplicatePack(pack.id); refresh(); toast('Kopie angelegt.', 'good'); }} />
        <Btn size="sm" icon="download" kind="ghost" title="Als Datei speichern" aria-label="Exportieren" onClick={() => P.exportPack(pack)} />
        {pack.builtin && pack.edited && (
          <Btn size="sm" icon="undo" kind="ghost" title="Auf den Auslieferungszustand zurücksetzen" aria-label="Zurücksetzen"
            onClick={() => openModal({ type: 'confirm', title: `„${pack.name}“ zurücksetzen?`, text: 'Alle deine Änderungen an diesem Paket gehen verloren.', yes: 'Zurücksetzen', action: () => { P.resetPack(pack.id); refresh(); } })} />
        )}
        {!pack.builtin && (
          <Btn size="sm" icon="trash" kind="ghost" title="Paket löschen" aria-label="Löschen"
            onClick={() => openModal({ type: 'confirm', title: `„${pack.name}“ löschen?`, text: 'Das Paket und alle seine Fragen werden entfernt.', yes: 'Löschen', action: () => { P.deletePack(pack.id); refresh(); } })} />
        )}
      </div>
    </li>
  );
}

export function PacksScreen() {
  const [editId, setEditId] = useState(null);
  const [, bump] = useState(0);
  const refresh = () => bump((x) => x + 1);
  if (editId) return <Editor packId={editId} onBack={() => { setEditId(null); emit(); }} />;
  const packs = P.allPacks();
  const importFile = async () => {
    const file = await P.pickFile('.json,.txt,application/json,text/plain');
    if (!file) return;
    try {
      const pack = P.importPackFile(await file.text());
      toast(`„${pack.name}“ mit ${pack.qs.length} Fragen importiert.`, 'good');
      setEditId(pack.id);
    } catch (e) {
      toast(e.message, 'bad', 6000);
    }
  };
  return (
    <div class="screen wide">
      <header class="screen-head">
        <Btn icon="left" kind="ghost" onClick={() => go(S.lobby ? 'room' : 'home')}>Zurück</Btn>
        <h1>Fragenpakete</h1>
        <div class="btnrow">
          <Btn icon="upload" onClick={importFile}>Importieren</Btn>
          <Btn kind="primary" icon="plus" onClick={() => setEditId(P.newPack().id)}>Neues Paket</Btn>
        </div>
      </header>
      <p class="muted">
        Jedes Paket lässt sich anpassen: einzelne Fragen ausschalten, löschen, ändern oder eigene ergänzen. Welche Pakete in einer Runde drankommen, wählt der Moderator in der Lobby.
      </p>
      <ul class="lib-grid">
        {packs.map((p) => <PackTile key={p.id} pack={p} onEdit={() => setEditId(p.id)} refresh={refresh} />)}
      </ul>
      <div class="btnrow">
        <Btn icon="refresh" kind="ghost" onClick={() => { P.resetPlayed(); toast('Brinkgame merkt sich nicht mehr, welche Fragen schon dran waren.', 'good'); }}>Gespielte Fragen vergessen</Btn>
        <span class="muted small">Brinkgame zieht bevorzugt Fragen, die ihr noch nicht hattet.</span>
      </div>
    </div>
  );
}

// ---------- editor ----------

function QuestionForm({ q, cats, onSave, onCancel, onDelete }) {
  const [f, setF] = useState({ ...q });
  const valid = f.a.trim() && (f.q.trim() || f.img);
  const addImage = async () => {
    const file = await P.pickFile('image/*');
    if (!file) return;
    try {
      setF({ ...f, img: await P.imageToDataUrl(file) });
    } catch {
      toast('Das Bild konnte nicht gelesen werden.', 'bad');
    }
  };
  return (
    <div class="q-form">
      <div class="q-form-row">
        <Field label="Kategorie">
          <select value={f.c} onChange={(e) => setF({ ...f, c: e.currentTarget.value })}>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Wert (Schwierigkeit)">
          <Seg value={f.l} onChange={(l) => setF({ ...f, l })} options={[1, 2, 3, 4, 5].map((l) => ({ value: l, label: LEVEL_LABEL[l] }))} />
        </Field>
      </div>
      <Field label="Frage oder Hinweis">
        <textarea rows="2" maxLength={600} value={f.q} placeholder="Zum Beispiel: Dieser Fluss ist der längste Europas." onInput={(e) => setF({ ...f, q: e.currentTarget.value })} autoFocus />
      </Field>
      <div class="q-form-row">
        <Field label="Antwort">
          <input value={f.a} maxLength={300} placeholder="Wolga" onInput={(e) => setF({ ...f, a: e.currentTarget.value })} onKeyDown={(e) => e.key === 'Enter' && valid && onSave(f)} />
        </Field>
        <Field label="Hinweis für den Moderator" hint="Optional, z. B. was auch gilt">
          <input value={f.n ?? ''} maxLength={300} onInput={(e) => setF({ ...f, n: e.currentTarget.value })} />
        </Field>
      </div>
      <div class="q-form-img">
        {f.img ? (
          <>
            <img src={P.imageSrc(f.img)} alt="" />
            <Btn size="sm" icon="trash" onClick={() => setF({ ...f, img: '' })}>Bild entfernen</Btn>
          </>
        ) : (
          <Btn size="sm" icon="image" onClick={addImage}>Bild hinzufügen</Btn>
        )}
        <span class="grow" />
        {onDelete && <Btn icon="trash" kind="danger ghost" onClick={onDelete}>Löschen</Btn>}
        <Btn onClick={onCancel}>Abbrechen</Btn>
        <Btn kind="primary" disabled={!valid} onClick={() => onSave({ ...f, q: f.q.trim(), a: f.a.trim(), n: f.n?.trim() || undefined, img: f.img || undefined })}>Speichern</Btn>
      </div>
    </div>
  );
}

function TextImport({ pack, onDone }) {
  const [text, setText] = useState('');
  const parsed = useMemo(() => P.parseTextQuestions(text, pack), [text]);
  return (
    <Modal
      title="Fragen als Text einfügen"
      wide
      footer={
        <>
          <span class="muted">{parsed.qs.length} Fragen erkannt{parsed.skipped ? `, ${parsed.skipped} Zeilen nicht lesbar` : ''}</span>
          <span class="grow" />
          <Btn onClick={closeModal}>Abbrechen</Btn>
          <Btn kind="primary" disabled={!parsed.qs.length} onClick={() => onDone(parsed)}>Hinzufügen</Btn>
        </>
      }
    >
      <p class="muted">Eine Frage pro Zeile: <code>Wert | Frage | Antwort | Hinweis</code>. Der Wert ist 1 bis 5 (für 100 bis 500). Eine Zeile mit <code># Name</code> beginnt eine Kategorie.</p>
      <textarea class="mono" rows="14" value={text} placeholder={'# Hauptstädte\n1 | Die Hauptstadt von Frankreich. | Paris\n2 | Die Hauptstadt von Kanada. | Ottawa | nicht Toronto'} onInput={(e) => setText(e.currentTarget.value)} autoFocus />
    </Modal>
  );
}

function Editor({ packId, onBack }) {
  const [pack, setPackState] = useState(() => structuredClone(P.getPack(packId)));
  const [cat, setCat] = useState('all');
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState(0);
  const [status, setStatus] = useState('all');
  const [editing, setEditing] = useState(null); // question id or 'new'
  const [limit, setLimit] = useState(150);

  const update = (next) => {
    setPackState(next);
    P.savePack(next);
  };
  const patch = (fields) => update({ ...pack, ...fields });
  const stats = P.packStats(pack);
  const catName = (id) => pack.cats.find((c) => c.id === id)?.name ?? '';

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = pack.qs.filter((q) => {
    if (cat !== 'all' && q.c !== cat) return false;
    if (level && q.l !== level) return false;
    if (status === 'on' && q.off) return false;
    if (status === 'off' && !q.off) return false;
    if (!words.length) return true;
    const hay = `${q.q} ${q.a} ${q.n ?? ''} ${catName(q.c)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const filtered = words.length > 0 || level || status !== 'all';
  const ids = new Set(matches.map((q) => q.id));
  const sorted = matches.slice().sort((a, b) => (a.c === b.c ? a.l - b.l : pack.cats.findIndex((c) => c.id === a.c) - pack.cats.findIndex((c) => c.id === b.c)));

  const setOff = (off) => update({ ...pack, qs: pack.qs.map((q) => (ids.has(q.id) ? { ...q, off: off || undefined } : q)) });
  const removeMatches = () => update({ ...pack, qs: pack.qs.filter((q) => !ids.has(q.id)) });
  const saveQuestion = (q) => {
    const exists = pack.qs.some((x) => x.id === q.id);
    update({ ...pack, qs: exists ? pack.qs.map((x) => (x.id === q.id ? q : x)) : [q, ...pack.qs] });
    setEditing(null);
  };

  const addCategory = () => {
    const c = P.newCategory(`Kategorie ${pack.cats.length + 1}`);
    update({ ...pack, cats: [...pack.cats, c] });
    setCat(c.id);
  };
  const deleteCategory = (id) => {
    update({ ...pack, cats: pack.cats.filter((c) => c.id !== id), qs: pack.qs.filter((q) => q.c !== id) });
    setCat('all');
  };

  const curCat = stats.cats.find((c) => c.id === cat);

  return (
    <div class="screen wide editor">
      <header class="screen-head">
        <Btn icon="left" kind="ghost" onClick={onBack}>Alle Pakete</Btn>
        <div class="editor-title">
          <input class="icon-input" value={pack.icon} maxLength={4} aria-label="Symbol" onInput={(e) => patch({ icon: e.currentTarget.value })} />
          <input class="title-input" value={pack.name} maxLength={60} aria-label="Name des Pakets" onInput={(e) => patch({ name: e.currentTarget.value })} />
        </div>
        <div class="btnrow">
          <Btn icon="download" onClick={() => P.exportPack(pack)}>Exportieren</Btn>
        </div>
      </header>

      <div class="editor-meta">
        <input class="desc-input" value={pack.desc} maxLength={200} placeholder="Kurzbeschreibung" onInput={(e) => patch({ desc: e.currentTarget.value })} />
        <div class="swatches" role="radiogroup" aria-label="Farbe">
          {COLORS.map((c) => <button type="button" key={c} class={pack.color === c ? 'on' : ''} style={{ '--c': c }} onClick={() => patch({ color: c })} aria-label={c} />)}
        </div>
        {pack.builtin && <span class="muted small">Mitgeliefertes Paket. Deine Änderungen bleiben auf diesem PC und lassen sich zurücksetzen.</span>}
      </div>

      <div class="editor-body">
        <aside class="cat-list">
          <button type="button" class={cat === 'all' ? 'on' : ''} onClick={() => setCat('all')}>
            <span>Alle Fragen</span><small>{stats.active}/{stats.total}</small>
          </button>
          {stats.cats.map((c) => (
            <button type="button" key={c.id} class={`${cat === c.id ? 'on' : ''} ${c.playable ? '' : 'unplayable'}`} onClick={() => setCat(c.id)} title={c.playable ? '' : 'Nicht spielbar: Es fehlt mindestens ein Wert zwischen 100 und 500.'}>
              <span>{c.name}</span>
              <small>{c.active}</small>
            </button>
          ))}
          <Btn size="sm" icon="plus" onClick={addCategory}>Kategorie</Btn>
        </aside>

        <section class="q-panel">
          {curCat && (
            <div class="cat-head">
              <input class="title-input sm" value={curCat.name} maxLength={60} aria-label="Name der Kategorie" onInput={(e) => patch({ cats: pack.cats.map((c) => (c.id === cat ? { ...c, name: e.currentTarget.value } : c)) })} />
              <span class="level-dots" title="Aktive Fragen je Wert">
                {curCat.per.map((n, i) => <span key={i} class={n ? '' : 'missing'}>{LEVEL_LABEL[i + 1]}: {n}</span>)}
              </span>
              <Btn size="sm" icon="trash" kind="danger ghost" onClick={() => openModal({ type: 'confirm', title: `Kategorie „${curCat.name}“ löschen?`, text: `${curCat.total} Fragen werden mit gelöscht.`, yes: 'Löschen', action: () => deleteCategory(cat) })}>Kategorie löschen</Btn>
            </div>
          )}
          <div class="q-toolbar">
            <label class="search big">
              <Icon name="search" size={18} />
              <input value={query} placeholder="Fragen durchsuchen: Text, Antwort oder Kategorie" onInput={(e) => { setQuery(e.currentTarget.value); setLimit(150); }} />
              {query && <button type="button" class="clear" onClick={() => setQuery('')} aria-label="Suche leeren"><Icon name="x" size={14} /></button>}
            </label>
            <select value={level} onChange={(e) => setLevel(Number(e.currentTarget.value))} aria-label="Wert filtern">
              <option value="0">Alle Werte</option>
              {[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.currentTarget.value)} aria-label="Status filtern">
              <option value="all">Aktive und ausgeschaltete</option>
              <option value="on">Nur aktive</option>
              <option value="off">Nur ausgeschaltete</option>
            </select>
          </div>
          <div class="q-bulk">
            <span><strong>{matches.length}</strong> {matches.length === 1 ? 'Frage' : 'Fragen'}{filtered ? ' gefunden' : ''}</span>
            {filtered && matches.length > 0 && (
              <>
                <Btn size="sm" onClick={() => setOff(true)}>Treffer ausschalten</Btn>
                <Btn size="sm" onClick={() => setOff(false)}>Treffer einschalten</Btn>
                <Btn size="sm" kind="danger ghost" icon="trash" onClick={() => openModal({ type: 'confirm', title: `${matches.length} Fragen löschen?`, text: 'Die gefundenen Fragen werden aus dem Paket entfernt.', yes: 'Löschen', action: removeMatches })}>Treffer löschen</Btn>
              </>
            )}
            <span class="grow" />
            <Btn size="sm" icon="list" onClick={() => openModal({ type: 'custom', render: () => <TextImport pack={pack} onDone={(res) => { update({ ...pack, cats: res.cats, qs: [...pack.qs, ...res.qs] }); closeModal(); toast(`${res.qs.length} Fragen hinzugefügt.`, 'good'); }} /> })}>Als Text einfügen</Btn>
            <Btn size="sm" kind="primary" icon="plus" disabled={!pack.cats.length} onClick={() => setEditing('new')}>Frage hinzufügen</Btn>
          </div>

          {editing === 'new' && <QuestionForm q={P.newQuestion(cat === 'all' ? pack.cats[0]?.id : cat, level || 1)} cats={pack.cats} onSave={saveQuestion} onCancel={() => setEditing(null)} />}

          {sorted.length === 0 ? (
            <Empty icon="search" title={pack.qs.length ? 'Keine Frage passt zur Suche' : 'Dieses Paket ist noch leer'}>
              {pack.qs.length ? 'Ändere den Suchtext oder die Filter.' : 'Füge Fragen einzeln hinzu oder füge gleich eine ganze Liste als Text ein.'}
            </Empty>
          ) : (
            <ul class="q-list">
              {sorted.slice(0, limit).map((q) => (
                editing === q.id ? (
                  <li key={q.id}><QuestionForm q={q} cats={pack.cats} onSave={saveQuestion} onCancel={() => setEditing(null)} onDelete={() => { update({ ...pack, qs: pack.qs.filter((x) => x.id !== q.id) }); setEditing(null); }} /></li>
                ) : (
                  <li key={q.id} class={`q-row ${q.off ? 'off' : ''}`}>
                    <span class={`lvl l${q.l}`}>{LEVEL_LABEL[q.l]}</span>
                    <button type="button" class="q-main" onClick={() => setEditing(q.id)} title="Bearbeiten">
                      {cat === 'all' && <span class="q-cat">{catName(q.c)}</span>}
                      <span class="q-text">{q.img && <img src={P.imageSrc(q.img)} alt="" />}{q.q}</span>
                      <span class="q-ans">{q.a}{q.n && <small> · {q.n}</small>}</span>
                    </button>
                    <label class="q-switch" title={q.off ? 'Ausgeschaltet: kommt nicht dran' : 'Aktiv'}>
                      <input type="checkbox" checked={!q.off} onChange={(e) => update({ ...pack, qs: pack.qs.map((x) => (x.id === q.id ? { ...x, off: e.currentTarget.checked ? undefined : true } : x)) })} />
                      <span class="toggle-track"><span class="toggle-thumb" /></span>
                    </label>
                    <Btn size="sm" icon="trash" kind="ghost" aria-label="Frage löschen" onClick={() => update({ ...pack, qs: pack.qs.filter((x) => x.id !== q.id) })} />
                  </li>
                )
              ))}
            </ul>
          )}
          {sorted.length > limit && <Btn onClick={() => setLimit(limit + 300)}>Weitere {Math.min(300, sorted.length - limit)} anzeigen</Btn>}
        </section>
      </div>
    </div>
  );
}
