// Anti-cheat monitor. Runs only while the renderer asks for it (a round with anti-cheat is live
// and the player agreed). It reads the titles of open windows and the program names behind them,
// plus which window is in front. It never reads screen contents, keystrokes or files.
const { desktopCapturer } = require('electron');
const { spawn } = require('node:child_process');

const INTERVAL_MS = 2500;

// PowerShell loop: one JSON line every interval with the foreground process and all processes that
// own a visible main window. Kept alive as one process so nothing is spawned per poll.
const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -Namespace Brink -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint pid);
'@
while ($true) {
  $fgPid = [uint32]0
  [void][Brink.Win]::GetWindowThreadProcessId([Brink.Win]::GetForegroundWindow(), [ref]$fgPid)
  $list = @(Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { @{ p = $_.Id; a = $_.ProcessName; t = $_.MainWindowTitle } })
  @{ fg = [int]$fgPid; list = $list } | ConvertTo-Json -Compress -Depth 4
  Start-Sleep -Milliseconds ${INTERVAL_MS}
}
`;

let ctx = null;
let timer = null;
let ps = null;
let psData = null; // last parsed PowerShell snapshot
let psBuffer = '';
let pokeTimer = null;

function startPowerShell() {
  if (process.platform !== 'win32' || ps) return;
  try {
    const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    ps = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    ps.stdout.setEncoding('utf8');
    ps.stdout.on('data', (chunk) => {
      psBuffer += chunk;
      let idx;
      while ((idx = psBuffer.indexOf('\n')) >= 0) {
        const line = psBuffer.slice(0, idx).trim();
        psBuffer = psBuffer.slice(idx + 1);
        if (!line.startsWith('{')) continue;
        try {
          psData = { at: Date.now(), ...JSON.parse(line) };
        } catch { /* partial line */ }
      }
      if (psBuffer.length > 1_000_000) psBuffer = '';
    });
    const gone = () => {
      ps = null;
      psData = null;
    };
    ps.on('error', gone);
    ps.on('exit', gone);
  } catch {
    ps = null;
  }
}

function stopPowerShell() {
  if (ps) {
    try {
      ps.kill();
    } catch { /* already gone */ }
  }
  ps = null;
  psData = null;
  psBuffer = '';
}

async function collect() {
  if (!ctx) return;
  const { window: win } = ctx;
  if (!win || win.isDestroyed()) return;
  const own = win.getTitle();
  const windows = [];
  const seen = new Set();
  let fg = null;
  let source = 'titles';

  const fresh = psData && Date.now() - psData.at < INTERVAL_MS * 3;
  if (fresh) {
    source = 'programs';
    const list = Array.isArray(psData.list) ? psData.list : psData.list ? [psData.list] : [];
    for (const item of list) {
      const entry = { title: String(item.t ?? ''), app: String(item.a ?? '') };
      if (item.p === psData.fg) fg = entry;
      if (item.p === process.pid || entry.title === own) continue;
      const key = `${entry.app}|${entry.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      windows.push(entry);
    }
  }

  // Window titles from the system: covers extra windows of one program and other platforms.
  try {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
    const known = new Set(windows.map((w) => w.title));
    for (const s of sources) {
      const title = String(s.name ?? '');
      if (!title || title === own || known.has(title)) continue;
      known.add(title);
      windows.push({ title, app: '' });
    }
    if (!fresh && !win.isFocused() && sources.length) {
      // without process info the topmost foreign window is the best guess for the foreground
      const top = sources.find((s) => s.name && s.name !== own);
      if (top) fg = { title: top.name, app: '' };
    }
  } catch { /* not available on this system */ }

  if (!ctx) return;
  const focused = win.isFocused();
  ctx.send({
    windows: windows.slice(0, 80),
    fg: focused ? null : fg,
    focused,
    displays: ctx.displays(),
    source,
  });
}

function start(context) {
  stop();
  ctx = context;
  startPowerShell();
  collect();
  timer = setInterval(() => {
    if (process.platform === 'win32' && !ps) startPowerShell();
    collect();
  }, INTERVAL_MS);
}

function stop() {
  clearInterval(timer);
  clearTimeout(pokeTimer);
  timer = null;
  ctx = null;
  stopPowerShell();
}

/** Called on focus changes so the moderator sees them right away instead of at the next poll. */
function poke() {
  if (!ctx) return;
  clearTimeout(pokeTimer);
  pokeTimer = setTimeout(collect, 350);
}

module.exports = { start, stop, poke };
