# Serwer online do gry Żużel

Mały serwer pośredniczący: tworzy pokoje z 4-literowym kodem i przekazuje pozycje graczy
między telefonami. Nie liczy fizyki, więc jest bardzo lekki (jeden darmowy/tani plan wystarczy).

## Jak to działa w grze

- Gracz 1 wybiera w menu **ONLINE → UTWÓRZ POKÓJ** i dostaje kod (np. `ERVQ`).
- Pozostali wybierają **ONLINE → DOŁĄCZ DO POKOJU** i wpisują kod (2-4 graczy).
- Host (twórca pokoju) naciska **START WYŚCIGU**. Wolne miejsca zajmują boty prowadzone przez hosta.
- Każdy steruje swoim motocyklem u siebie (lewo / prawo / oba naraz = hamulec), a pozycje są wysyłane
  20 razy na sekundę. Po wyścigu wszyscy wracają do poczekalni, punkty sumują się w pokoju.
- Jeśli host wyjdzie, pokój zamyka się dla wszystkich (to on prowadzi boty).

## Test lokalny (komputer)

```
npm install
npm start          # nasłuchuje na porcie 8080
npm test           # test automatyczny serwera (port 8099)
```

W `zuzel.gd` ustaw na czas testu `SERVER_URL := "ws://IP_KOMPUTERA:8080"`
(w sieci Wi-Fi telefon musi widzieć komputer).

## Wdrożenie w internecie (żeby grać przez LTE / z innej sieci)

Potrzebujesz hostingu, który uruchamia Node.js i obsługuje WebSocket oraz daje adres `https://`
(gra łączy się wtedy przez `wss://`). Sprawdź aktualne warunki darmowych planów, bo się zmieniają.
Przykład na **Render.com** (Web Service):

1. Wrzuć folder `zuzel-server` jako repozytorium na GitHub (pliki: `server.js`, `package.json`, `README.md`).
2. Na render.com: **New → Web Service**, wskaż repozytorium.
3. Runtime: **Node**, Build Command: `npm install`, Start Command: `npm start`.
4. Po wdrożeniu dostaniesz adres typu `https://zuzel-xxxx.onrender.com`.
5. W `zuzel.gd` ustaw: `const SERVER_URL := "wss://zuzel-xxxx.onrender.com"`.

Uwagi:
- Darmowe plany zwykle usypiają serwer po okresie bezczynności. Pierwsze połączenie po przerwie
  może trwać do minuty. Gra czeka na serwer do 60 s (`NET_CONNECT_TIMEOUT`) i pokazuje komunikat.
- Inne opcje: Fly.io, Railway, Koyeb albo własny VPS (`node server.js`, port z zmiennej `PORT`;
  przed serwerem postaw proxy z HTTPS, np. Caddy, żeby był `wss://`).
- Wejście w adres serwera w przeglądarce pokazuje `zuzel-server ok` (przydatne jako health check).

## Eksport gry (Android)

W Godot: **Projekt → Eksport → Android → Uprawnienia → Internet** musi być zaznaczone,
inaczej telefon nie połączy się z serwerem.

## Bezpieczeństwo i limity

- Maks. 4 graczy w pokoju, wiadomości do 4 KB, limit 80 wiadomości na sekundę na klienta.
- Nicki są czyszczone (do 9 znaków, tylko litery, cyfry, spacja, `_` i `-`).
- Gość może wysyłać tylko pozycję własnego motocykla; boty może wysyłać tylko host.
- Gra jest "ufna": każdy telefon liczy własną jazdę, więc ktoś ze zmodyfikowanym klientem mógłby oszukiwać.
  Do gry ze znajomymi to wystarczy; do rankingów publicznych potrzebny byłby serwer liczący fizykę.
- Puste albo nieaktywne pokoje znikają po 30 minutach.
