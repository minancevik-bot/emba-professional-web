# KulüpAsist Mobil Uygulama Planı

Bu doküman, mevcut `emba-professional-web / KulüpAsist` web uygulamasının iOS ve Android mobil uygulamaya dönüştürülmesi için teknik yol haritasıdır.

Amaç, mevcut web panelini bozmak yerine aynı veritabanı ve aynı backend API üzerine çalışan profesyonel bir mobil uygulama geliştirmektir.

## 1. Hedef

KulüpAsist mobil uygulaması şu kullanıcıların cep telefonundan hızlı işlem yapmasını sağlamalıdır:

- Admin / otomasyon sorumlusu
- Kulüp yöneticisi
- Koordinatör
- Antrenör
- Yardımcı personel
- İzleyici rolündeki kullanıcılar

Mobil uygulama özellikle şu işlerde güçlü olmalıdır:

- Öğrenci arama
- Öğrenci detay görüntüleme
- Yoklama alma
- Yoklama raporu görüntüleme
- Ödeme takibi
- Borçlu öğrenci listesi
- Kullanıcı rolüne göre yetkili ekran gösterimi

## 2. Önerilen Teknoloji

En uygun başlangıç önerisi:

```text
Expo + React Native + TypeScript
```

Neden Expo?

- iOS ve Android için tek kod tabanı sağlar.
- İlk kurulum ve test süreci hızlıdır.
- Telefon üzerinden Expo Go ile kolay test yapılır.
- Daha sonra App Store ve Google Play yayınına uygundur.
- Kamera, bildirim, dosya indirme, güvenli depolama gibi ihtiyaçlar kolay eklenir.

Alternatifler:

| Seçenek | Ne zaman tercih edilir? |
| --- | --- |
| PWA | Çok hızlı, düşük maliyetli, mağazasız mobil deneyim istenirse |
| Expo React Native | Profesyonel mobil uygulama için en dengeli seçenek |
| Native iOS + Native Android | Büyük ekip ve yüksek bütçe varsa |
| Flutter | React yerine Dart tercih edilirse |

Bu proje için önerilen yol:

```text
1. Aşama: Expo React Native mobil uygulama
2. Aşama: Push bildirimleri
3. Aşama: App Store / Google Play yayını
```

## 3. Mevcut Sistemle İlişki

Mobil uygulama yeni bir veritabanı kurmamalıdır.

Mobil uygulama şunu kullanmalıdır:

```text
Mevcut PostgreSQL / Supabase veritabanı
Mevcut Express backend API
Mevcut kullanıcı girişi ve rol sistemi
```

Mobil uygulama doğrudan veritabanına bağlanmamalıdır.

Doğru mimari:

```text
Mobil Uygulama
      |
      v
KulüpAsist API
      |
      v
PostgreSQL / Supabase
```

Yanlış mimari:

```text
Mobil Uygulama
      |
      v
PostgreSQL
```

Veritabanı bağlantı bilgileri mobil uygulama içine kesinlikle yazılmamalıdır.

## 4. Mobil Uygulama Modülleri

### 4.1 Giriş Ekranı

Özellikler:

- Kullanıcı adı / e-posta
- Şifre
- Beni hatırla
- Güvenli oturum saklama
- Pasif kullanıcı girişini engelleme
- Rol bilgisine göre doğru ana sayfaya yönlendirme

Kullanılacak API:

```text
POST /api/auth/login
GET /api/auth/me
POST /api/auth/logout
```

Mobilde oturum bilgisi için:

```text
expo-secure-store
```

kullanılması önerilir.

### 4.2 Ana Panel

Gösterilecek özetler:

- Toplam öğrenci
- Aktif öğrenci
- Bugünkü ders saatleri
- Yoklama durumu
- Ödeme özeti
- Borçlu öğrenci sayısı

Kullanılacak API:

```text
GET /api/dashboard
```

### 4.3 Öğrenci Listesi

Özellikler:

- Öğrenci arama
- Durum filtresi
- Alfabetik liste
- Öğrenci kartı görünümü
- Detay ekranına geçiş

Mobil kart örneği:

```text
ALYA DURU
Durum: Aktif
Ders: Salı 17:30 / Perşembe 17:30
Seviye: Başlangıç
```

Kullanılacak API:

```text
GET /api/students
GET /api/students?q=...
GET /api/students?status=Aktif
```

### 4.4 Öğrenci Detay

Gösterilecek bilgiler:

- Öğrenci adı
- Yaş / doğum yılı
- Seviye
- Ders gün ve saatleri
- Veli bilgisi
- Telefon
- Ödeme geçmişi
- Yoklama geçmişi

Kullanılacak API:

```text
GET /api/students/:id
```

### 4.5 Yoklama Al

Bu mobil uygulamanın en önemli ekranlarından biridir.

Akış:

1. Tarih seçilir.
2. Ders saatleri listelenir.
3. Saat seçilir.
4. O saatteki öğrenciler kart olarak gelir.
5. Her öğrenci için durum seçilir:

```text
Geldi
Gelmedi
Mazeretli
```

6. Yoklama kaydedilir.

Kullanılacak API:

```text
GET /api/attendance/slots?date=YYYY-MM-DD
GET /api/attendance/lesson-students?date=YYYY-MM-DD&time=HH:mm
POST /api/attendance/bulk
```

Mobil tasarım ilkesi:

- Butonlar en az 44px dokunma alanına sahip olmalı.
- Öğrenciler tablo değil kart olarak gösterilmeli.
- Arama alanı üstte sabitlenmemeli, normal akışta kalmalı.
- Kayıt butonu ekran altında görünür ama içerik üstüne binmeyecek şekilde tasarlanmalı.

### 4.6 Yoklama Raporları

Özellikler:

- Tarih seçme
- Saat bazlı yoklama özeti
- Geldi / gelmedi / mazeretli sayıları
- Saat detayına girme
- Yetkiye göre düzenleme

Kullanılacak API:

```text
GET /api/reports/attendance-days?date=YYYY-MM-DD
GET /api/reports/attendance-detail?date=YYYY-MM-DD&time=HH:mm
PATCH /api/reports/attendance-records/:id
```

Not:

Yoklama iptal sistemi için backend tarafında ek migration gerekebilir. Bu özellik mobil uygulamada ilk sürümde gizli tutulabilir.

### 4.7 Ödemeler

Özellikler:

- Aylık ödeme listesi
- Borçlu öğrenciler
- Ödenen / kalan tutar
- WhatsApp ile veliye mesaj gönderme
- Ödeme detay görüntüleme

Kullanılacak API:

```text
GET /api/payments?month=YYYY-MM
POST /api/payments
DELETE /api/payments/:id
```

Rol kuralı:

- Coach ödeme alanını görmemelidir.
- İzleyici sadece yetkisi varsa görüntülemelidir.
- Silme işlemi sadece yetkili rollerde görünmelidir.

### 4.8 Kullanıcılar

Mobil ilk sürümde bu ekran sadece admin / manager için açılmalıdır.

Özellikler:

- Kullanıcı listesi
- Rol görüntüleme
- Aktif / pasif durumu
- Kullanıcı düzenleme

Kullanılacak API:

```text
GET /api/users
POST /api/users
PATCH /api/users/:id
```

## 5. Rol Bazlı Ekran Kuralları

| Rol | Mobilde görebileceği ana alanlar |
| --- | --- |
| super_admin | Tüm kulüpler, kullanıcılar, raporlar |
| manager | Kendi kulübü, öğrenciler, yoklama, ödemeler, kullanıcılar |
| coordinator | Öğrenciler, yoklama, ödemeler |
| coach | Kendi kulübü öğrencileri, yoklama alma, yoklama raporu |
| assistant | Yetki verilen operasyon ekranları |
| viewer | Sadece görüntüleme ekranları |

Mobil uygulama sadece menüleri gizlemekle yetinmemelidir.

Backend yetki kontrolü zaten korunmalıdır:

```text
Frontend: ekranı gizler
Backend: yetkisiz işlemi reddeder
```

## 6. Güvenlik

Mobil uygulamada dikkat edilecekler:

- `DATABASE_URL` mobil uygulamaya yazılmayacak.
- `SESSION_SECRET` mobil uygulamaya yazılmayacak.
- Service role key kullanılmayacak.
- Şifre telefonda düz metin saklanmayacak.
- Oturum tokenı güvenli depolama alanında tutulacak.
- Logout olunca token temizlenecek.
- API istekleri sadece HTTPS üzerinden yapılacak.

Önerilen mobil ortam değişkenleri:

```text
EXPO_PUBLIC_API_URL=https://emba-professional-web.onrender.com
```

## 7. Proje Klasör Yapısı Önerisi

Mobil uygulama ayrı klasörde tutulmalıdır:

```text
kulupasist-mobile/
  app/
    login.tsx
    dashboard.tsx
    students/
      index.tsx
      [id].tsx
    attendance/
      index.tsx
      report.tsx
    payments/
      index.tsx
    users/
      index.tsx
  src/
    api/
      client.ts
      auth.ts
      students.ts
      attendance.ts
      payments.ts
    components/
      StudentCard.tsx
      PaymentCard.tsx
      AttendanceCard.tsx
      EmptyState.tsx
    hooks/
      useAuth.ts
      usePermissions.ts
    theme/
      colors.ts
      spacing.ts
```

Önerilen router:

```text
expo-router
```

## 8. Kurulum Komutları

Yeni mobil proje oluşturma:

```powershell
npx create-expo-app kulupasist-mobile
cd kulupasist-mobile
npm install expo-secure-store
npm install expo-router react-native-safe-area-context react-native-screens
```

Geliştirme sunucusu:

```powershell
npm start
```

Telefonda test:

```text
Expo Go uygulamasını aç
QR kodu okut
```

## 9. API Client Örneği

Mobil uygulamada tüm API istekleri tek merkezden yönetilmelidir.

Örnek mantık:

```ts
const API_URL = process.env.EXPO_PUBLIC_API_URL;

export async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "İşlem tamamlanamadı.");
  }

  return data;
}
```

Not:

Mevcut web uygulamasında session cookie kullanılıyor. Mobil uygulama için backend tarafında token tabanlı giriş daha sağlıklı olabilir. İlk aşamada cookie destekli fetch denenebilir, ancak profesyonel mobil sürüm için ayrıca mobil token endpointleri önerilir.

## 10. Backend Tarafında Gerekebilecek Eklemeler

Mobil uygulama için aşağıdaki API iyileştirmeleri düşünülebilir:

```text
POST /api/mobile/auth/login
POST /api/mobile/auth/logout
GET /api/mobile/auth/me
```

Bu endpointler:

- Kullanıcı adı / şifre ile giriş yapmalı.
- Güvenli mobil token üretmeli.
- Token süresi ve yenileme mantığı olmalı.
- Pasif kullanıcıyı reddetmeli.
- Kullanıcının rol ve permissions bilgisini döndürmeli.

İlk mobil sürüm web API ile başlatılabilir, ancak mağaza kalitesinde uygulama için mobil token sistemi daha profesyoneldir.

## 11. Bildirimler

İkinci aşamada push bildirimleri eklenebilir.

Bildirim örnekleri:

- Bugünkü ders saati hatırlatma
- Ödeme günü yaklaşan öğrenciler
- Eksik ödeme uyarısı
- Yoklama alınmadı uyarısı
- Yeni öğrenci kaydı bildirimi

Önerilen teknoloji:

```text
Expo Push Notifications
```

## 12. Offline Kullanım

İlk sürüm online çalışabilir.

Daha sonra şu offline özellikler eklenebilir:

- Yoklama ekranının önceden yüklenmesi
- İnternet yokken işaretleme yapılması
- İnternet gelince senkronize edilmesi

Bu özellik dikkatli yapılmalıdır, çünkü aynı yoklama farklı cihazlardan değiştirilebilir.

## 13. Tasarım İlkeleri

Mobil uygulama web panelinin birebir küçültülmüş hali olmamalıdır.

Mobil için doğru yaklaşım:

- Tablo yerine kart
- Az metin
- Büyük dokunma alanı
- Alt menü navigasyonu
- Hızlı arama
- Hızlı yoklama
- Net durum renkleri

Önerilen alt menü:

```text
Panel
Öğrenciler
Yoklama
Ödemeler
Profil
```

Coach rolü için:

```text
Panel
Öğrencilerim
Yoklama
Rapor
Profil
```

## 14. MVP Sürüm Kapsamı

İlk mobil sürümde yapılması gerekenler:

1. Login
2. Rol bazlı ana menü
3. Dashboard özeti
4. Öğrenci listesi
5. Öğrenci detay
6. Yoklama alma
7. Yoklama raporu
8. Ödeme listesi
9. Logout

İlk sürümde ertelenebilecekler:

- Push bildirim
- Offline çalışma
- Kullanıcı yönetimi
- Kulüp oluşturma
- Yedek alma
- Excel import
- Gelişmiş grafikler

## 15. Yayınlama Planı

### Android

```text
Google Play Console hesabı açılır.
EAS Build ile Android App Bundle üretilir.
Kapalı test yapılır.
Production yayına alınır.
```

### iOS

```text
Apple Developer hesabı gerekir.
EAS Build ile iOS build alınır.
TestFlight ile test edilir.
App Store yayını yapılır.
```

Önerilen build aracı:

```text
EAS Build
```

Kurulum:

```powershell
npm install -g eas-cli
eas login
eas build:configure
```

## 16. Geliştirme Aşamaları

### Aşama 1: Hazırlık

- Mobil uygulama repo/klasörü oluşturulur.
- API URL ayarlanır.
- Login ekranı yapılır.
- Auth state yönetimi kurulur.

### Aşama 2: Temel Ekranlar

- Dashboard
- Öğrenci listesi
- Öğrenci detay
- Yoklama saatleri
- Yoklama öğrenci kartları

### Aşama 3: Operasyon

- Yoklama kaydetme
- Ödeme listeleme
- Raporlama ekranı
- Role göre ekran gizleme

### Aşama 4: Test

- Admin testi
- Manager testi
- Coach testi
- Assistant testi
- Viewer testi
- Pasif kullanıcı testi
- Android telefon testi
- iPhone testi

### Aşama 5: Yayın

- Uygulama ikonu
- Splash screen
- Privacy policy
- Google Play kapalı test
- App Store TestFlight

## 17. Test Senaryoları

Mobil uygulama yayına çıkmadan önce:

- Kullanıcı login olabiliyor mu?
- Pasif kullanıcı giremiyor mu?
- Coach ödeme ekranını görmüyor mu?
- Öğrenci arama çalışıyor mu?
- Yoklama saatleri geliyor mu?
- Saat seçince öğrenci listesi geliyor mu?
- Yoklama kaydetme başarılı mı?
- Raporlama doğru sayıları gösteriyor mu?
- Logout çalışıyor mu?
- Uygulama kapatılıp açılınca oturum korunuyor mu?
- İnternet kesilince anlaşılır hata mesajı veriyor mu?

## 18. Önerilen İlk İş

En mantıklı ilk görev:

```text
kulupasist-mobile adında Expo React Native projesi oluştur.
Mevcut Render API adresine bağlanan login ekranını yap.
GET /api/auth/me ile oturum kontrolünü kur.
Rol bazlı alt menü iskeletini oluştur.
```

Bu tamamlandığında mobil uygulamanın temel omurgası hazır olur.

## 19. Kısa Karar

Bu proje için en doğru mobil uygulama yolu:

```text
Expo React Native + mevcut Express API + PostgreSQL/Supabase veritabanı
```

Veritabanı ve web paneli korunur.

Mobil uygulama sadece yeni bir istemci olarak sisteme bağlanır.

Bu sayede hem web panel hem mobil uygulama aynı veriyi güvenli şekilde kullanır.
