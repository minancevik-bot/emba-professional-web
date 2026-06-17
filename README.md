# EMBA Spor Kulübü Profesyonel Web Uygulaması

Bu sürüm, önceki yerel `state.json` / tarayıcı belleği mantığını bırakıp PostgreSQL tabanlı gerçek web uygulamasına dönüşür.

## Neler Var?

- İnternet üzerinden linkle erişilebilen Express + PostgreSQL uygulaması
- Güvenli giriş sistemi
- Roller: `admin`, `koordinator`, `antrenor`, `izleyici`
- Şifreleri düz metin yerine `scrypt` hash ile saklama
- Öğrenci, ders slotu, yoklama, ödeme, kullanıcı ve işlem kayıtları
- Rol bazlı API yetki kontrolü
- Otomatik JSON yedekleme
- Mobil uyumlu panel arayüzü
- Render, Railway, Fly.io, VPS ve Supabase PostgreSQL ile çalışabilecek yapı

## Rol Yetkileri

| Rol | Yetki |
| --- | --- |
| admin | Tüm işlemler, kullanıcı ekleme, öğrenci silme, ödeme silme, yedek alma |
| koordinator | Öğrenci, yoklama ve ödeme ekleme/güncelleme, rapor ve yedek listesi görme |
| antrenor | Öğrenci listesini görme ve yoklama işleme |
| izleyici | Sadece panel, öğrenci ve yoklama görüntüleme |

## Yerel Kurulum

1. Node.js 20 veya üzerini kur.
2. PostgreSQL kur.
3. Bu klasöre gir:

```powershell
cd "C:\Users\İnan Çevik\Documents\Codex\2026-06-17\ne-i-e-yariyor-bu-uygulama\outputs\emba-professional-web"
```

4. `.env.example` dosyasını `.env` olarak kopyala:

```powershell
Copy-Item .env.example .env
```

5. PostgreSQL içinde veritabanı oluştur:

```powershell
createdb emba_professional
```

6. Bağımlılıkları kur:

```powershell
npm install
```

7. Tabloları oluştur:

```powershell
npm run migrate
```

8. Uygulamayı başlat:

```powershell
npm start
```

9. Tarayıcıdan aç:

```text
http://localhost:3000
```

İlk giriş bilgisi `.env` dosyasındaki değerlere göre oluşur:

```text
Kullanıcı adı: admin
Şifre: ADMIN_PASSWORD değeriniz
```

## Eski Veriyi Aktarma

Önce migrasyonu çalıştır. Sonra eski `emba-yuzme-app/data.js` içindeki veriyi PostgreSQL'e aktar:

```powershell
npm run import-legacy
```

Farklı bir dosya vermek istersen:

```powershell
npm run import-legacy -- ..\emba-yuzme-app\data.js
```

Import scripti mevcut Supabase/PostgreSQL tablolarını silmez. Aynı öğrenci daha önce eklendiyse `full_name + phone`, telefon yoksa `full_name` ile kontrol eder ve tekrar öğrenci oluşturmaz.

Komut çalışırken şifre gizlenmiş şekilde hangi `DATABASE_URL` adresine bağlandığını, kaç öğrenci/ders saati/ödeme aktardığını ve kaç kaydı tekrar olduğu için atladığını yazar.

## Ortam Değişkenleri

| Değişken | Açıklama |
| --- | --- |
| `DATABASE_URL` | PostgreSQL veya Supabase bağlantı adresi |
| `SESSION_SECRET` | Oturum çerezini imzalamak için uzun rastgele metin |
| `ADMIN_USERNAME` | İlk admin kullanıcı adı |
| `ADMIN_PASSWORD` | İlk admin şifresi |
| `DATABASE_SSL` | Uzak veritabanında genelde `true` |
| `PORT` | Sunucu portu |
| `AUTO_BACKUP_HOURS` | Otomatik yedekleme aralığı |

## Supabase PostgreSQL Kullanma

1. [Supabase](https://supabase.com) hesabı aç.
2. Yeni proje oluştur.
3. Project Settings > Database bölümünden connection string al.
4. `.env` veya deploy panelinde şu şekilde ayarla:

```text
DATABASE_URL=postgresql://postgres:[SIFRE]@[HOST]:5432/postgres
DATABASE_SSL=true
```

5. `npm run migrate` komutu tabloları Supabase veritabanında oluşturur.

## Render ile Yayınlama

1. Bu klasörü GitHub reposuna gönder.
2. Render'da New > Web Service seç.
3. Repository'yi bağla.
4. Build Command:

```text
npm install
```

5. Start Command:

```text
npm run migrate && npm start
```

6. Environment Variables ekle:

```text
NODE_ENV=production
DATABASE_URL=...
DATABASE_SSL=true
SESSION_SECRET=uzun-rastgele-bir-deger
ADMIN_USERNAME=admin
ADMIN_PASSWORD=guclu-bir-sifre
AUTO_BACKUP_HOURS=24
```

7. Deploy bitince Render sana bir link verir. Kullanıcılar o linkten giriş yapar.

Not: Render'ın ücretsiz/geçici disk alanında `backups/` klasörü kalıcı olmayabilir. Profesyonel kullanımda Render Persistent Disk, Supabase otomatik yedekleri veya harici depolama kullan.

## Railway ile Yayınlama

1. Railway'de yeni proje aç.
2. PostgreSQL servisi ekle.
3. Uygulama servisini GitHub reposundan bağla.
4. `DATABASE_URL` değerini Railway PostgreSQL servisinden al.
5. Değişkenleri ekle: `SESSION_SECRET`, `ADMIN_PASSWORD`, `DATABASE_SSL=true`.
6. Build komutu `npm install`, start komutu `npm run migrate && npm start`.

## Fly.io ile Yayınlama

1. Fly CLI kur.
2. Proje klasöründe:

```powershell
fly launch
fly postgres create
fly postgres attach
fly secrets set SESSION_SECRET="uzun-rastgele" ADMIN_PASSWORD="guclu-sifre" DATABASE_SSL="true"
fly deploy
```

3. İlk deploy öncesi veya sonrası migrasyon çalıştır:

```powershell
fly ssh console -C "npm run migrate"
```

## VPS ile Yayınlama

1. Ubuntu sunucu al.
2. Node.js 20, PostgreSQL, Nginx ve Certbot kur.
3. Bu projeyi sunucuya kopyala.
4. `.env` dosyasını oluştur.
5. Şunları çalıştır:

```bash
npm install
npm run migrate
npm start
```

6. Sürekli çalışması için PM2 kullan:

```bash
npm install -g pm2
pm2 start src/server.js --name emba
pm2 save
```

7. Nginx ile domaini `localhost:3000` adresine yönlendir.
8. Certbot ile SSL sertifikası kur.

## Yedekleme Mantığı

Uygulama `AUTO_BACKUP_HOURS` değerine göre `backups/` klasörüne JSON yedeği üretir. Admin panelinden elle yedek de alınabilir.

Üretim ortamında en güvenli yöntem:

- PostgreSQL sağlayıcısının otomatik yedeğini açmak
- Supabase/Railway/Render database backup kullanmak
- `backups/` klasörünü kalıcı disk veya bulut depolamaya taşımak

## Kullanıcı Oluşturma

Admin panele girdikten sonra Kullanıcılar ekranından yeni kullanıcı ekleyebilirsin.

Komut satırından admin şifresi yenilemek için:

```powershell
npm run create-admin -- admin YeniGucluSifre123
```

## Önemli Güvenlik Notları

- `ADMIN_PASSWORD` güçlü olmalı.
- `SESSION_SECRET` rastgele ve uzun olmalı.
- Production ortamında `DATABASE_SSL=true` kullanılmalı.
- Veritabanı şifresi kodun içine yazılmamalı.
- Kullanıcıların şifreleri veritabanında düz metin olarak tutulmaz.
