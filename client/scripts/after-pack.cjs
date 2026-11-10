// Sets the icon and version info on the Windows exe without needing Wine or rcedit,
// so the app can be built on Linux and macOS as well.
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const iconFile = path.join(context.packager.projectDir, 'build/icon.ico');
  if (!fs.existsSync(exe) || !fs.existsSync(iconFile)) return;
  const { load } = require('resedit/cjs');
  const ResEdit = await load();
  const pe = ResEdit.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(pe);
  const icon = ResEdit.Data.IconFile.from(fs.readFileSync(iconFile));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const id = groups[0]?.id ?? 1;
  const lang = groups[0]?.lang ?? 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, icon.icons.map((i) => i.data));
  const version = context.packager.appInfo.version;
  const [major, minor, patch] = version.split('.').map((n) => Number(n) || 0);
  for (const vi of ResEdit.Resource.VersionInfo.fromEntries(res.entries)) {
    vi.setFileVersion(major, minor, patch, 0, lang);
    vi.setProductVersion(major, minor, patch, 0, lang);
    for (const l of vi.getAllLanguagesForStringValues()) {
      vi.setStringValues(l, {
        ProductName: 'Brinkgame',
        FileDescription: 'Brinkgame',
        CompanyName: 'Brinkgame',
        LegalCopyright: 'Brinkgame',
        OriginalFilename: 'Brinkgame.exe',
        InternalName: 'Brinkgame',
      });
    }
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(pe);
  fs.writeFileSync(exe, Buffer.from(pe.generate()));
  console.log('  • Icon und Versionsinfo in die exe geschrieben');
};
