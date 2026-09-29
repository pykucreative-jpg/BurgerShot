# BurgerShot 🍔
Samodzielny bot Discord. Bez strony, ticketów, czarnej listy, zdjęć i SSN.

## Komendy
- /zatrudnij osoba [imie_i_nazwisko_ic] — Rekrut + Firma Dc. Imię opcjonalne, bez niego nick pozostaje.
- /plus osoba powod — piąty plus zeruje licznik.
- /minus osoba powod — drugi minus odbiera zarządzalne rangi i wyrzuca z serwera.
- /awans osoba powod oraz /degrad osoba powod — jeden stopień w skonfigurowanej hierarchii.
- /zwolnij osoba powod — odbiera zarządzalne rangi i wyrzuca z serwera.
- /urlop osoba do_kiedy — DD.MM, bieżący rok, koniec dnia w Europe/Warsaw.
- /zdejmijurlop osoba powod — ręczne zakończenie urlopu.

Dostęp wyłącznie dla rangi kadry zapisanej w src/config.js. Zmiany i wykonawcy trafiają do PostgreSQL i kanału logów. Urlopy przetrwają restart, co 15 sekund bot sprawdza termin i wysyła powiadomienie na kanał użycia komendy. W razie braku uprawnień próbuje ponownie po 5 minutach. Role Discord i baza nie tworzą jednej transakcji — częściowe błędy są logowane. Kolejka wysyłek może powtórzyć wiadomość po awarii między wysłaniem a potwierdzeniem w bazie.

## Railway
1. Utwórz osobny projekt, usługę z tego repozytorium oraz PostgreSQL o nazwie Postgres.
2. W usłudze bota ustaw DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID=1292911416248111247, DATABASE_URL jako odwołanie do Postgres.DATABASE_URL, NODE_ENV=production.
3. Użyj Dockerfile, jednej repliki i wyłącz usypianie/serverless. Bez domeny, portu i HTTP healthcheck — to stale działający bot.
4. Wdróż zmiany. W logach powinno być: BurgerShot gotowy — 8 komend.

W Discord Developer Portal włącz Server Members Intent. Zaproś bota ze scopes bot i applications.commands. Uprawnienia: View Channels, Send Messages, Embed Links, Manage Roles, Manage Nicknames, Kick Members. Rola bota musi być ponad rangami i osobami, którymi zarządza. Message Content Intent nie jest potrzebny.

## Lokalnie
Node >=22.12, npm ci, skopiuj .env.example do .env i uzupełnij, npm start. npm test oraz npm run check do kontroli. Nie publikuj .env ani tokenu. Baza musi być osobna dla tego bota.

Nagrody: po piątym plusie licznik wraca do zera, a ukończony cykl zostaje w historii. Co niedzielę o 20:00 Europe/Warsaw bot kolejkuje na logach nowe nagrody (wiele cykli jednej osoby sumuje). Brak nagród oznacza brak wiadomości. Po przerwie nadrabia zestawienie po uruchomieniu. Zestawienie nie potwierdza wypłaty; nagrody już wykazane nie są ponawiane w następnym tygodniu.

Codziennie o 20:00 Europe/Warsaw: przypomnienie o kursach na kanale 1502335151324004457 z oznaczeniem roli 1465037223350243390. Kontrola co sekundę; po restarcie po 20:00 nadrabia wiadomość tego dnia. Baza zapobiega ponownemu zaplanowaniu tego samego dnia. Dostarczenie zależy od dostępności Discord i bota.
