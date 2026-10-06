fetch('/api/app/android')
  .then((r) => r.json())
  .then((a) => {
    const v = document.getElementById('version');
    const btn = document.getElementById('download');
    if (!a.apkUrl) {
      v.textContent = 'Uygulama çok yakında burada.';
      return;
    }
    v.textContent = `Sürüm ${a.versionName}${a.notes ? ' · ' + a.notes : ''}`;
    btn.href = a.apkUrl;
    btn.classList.remove('hidden');
  })
  .catch(() => {});
