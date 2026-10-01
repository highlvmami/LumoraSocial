if (new URLSearchParams(location.search).get('durum') !== 'ok') {
  document.getElementById('icon').textContent = '';
  document.getElementById('title').textContent = 'Bağlantı geçersiz';
  document.getElementById('text').textContent =
    'Bu doğrulama bağlantısı kullanılmış ya da süresi dolmuş. Ayarlar > Hesap bölümünden yeni bir bağlantı isteyebilirsin.';
}
