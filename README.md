# BurgerShot 🍔
Samodzielny bot Discord. Bez strony, ticketów, czarnej listy, zdjęć i SSN.

## Komendy
- /zatrudnij osoba [imie_i_nazwisko_ic] — Rekrut + Firma Dc. Imię opcjonalne, bez niego nick pozostaje.
- /plus osoba powod — piąty plus zeruje licznik.
- /minus osoba powod — drugi minus odbiera zarządzalne rangi i wyrzuca z serwera.
- /awans osoba powod oraz /degrad osoba powod — jeden stopień w skonfigurowanej hierarchii.
- /zwolnij osoby powod — do 20 oznaczeń osób lub ID oddzielonych spacją, wspólny powód. Działa od razu, bez potwierdzenia; usuwa duplikaty, pokazuje sukcesy i błędy. Odbiera zarządzalne rangi i wyrzuca z serwera.
- /urlop osoba do_kiedy — DD.MM, bieżący rok, koniec dnia w Europe/Warsaw.
- /zdejmijurlop osoba powod — ręczne zakończenie urlopu.

Dostęp wyłącznie dla rangi kadry zapisanej w src/config.js. Zmiany i wykonawcy trafiają do PostgreSQL i kanału logów. Urlopy przetrwają restart, co 15 sekund bot sprawdza termin i wysyła powiadomienie na kanał użycia komendy. W razie braku uprawnień próbuje ponownie po 5 minutach. Role Discord i baza nie tworzą jednej transakcji — częściowe błędy są logowane. Kolejka wysyłek może powtórzyć wiadomość po awarii między wysłaniem a potwierdzeniem w bazie.

## Railway
1. Utwórz osobny projekt, usługę z tego repozytorium oraz PostgreSQL o nazwie Postgres.
2. W usłudze bota ustaw DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID=1292911416248111247, DATABASE_URL jako odwołanie do Postgres.DATABASE_URL, NODE_ENV=production.
3. Użyj Dockerfile, jednej repliki i wyłącz usypianie/serverless. Panel WWW działa na porcie PORT (domyślnie 3000); domenę HTTPS można wygenerować w Railway. Bot wymaga stałego działania.
4. Wdróż zmiany. W logach powinno być: BurgerShot gotowy — komendy zsynchronizowane.

W Discord Developer Portal włącz Server Members Intent. Zaproś bota ze scopes bot i applications.commands. Uprawnienia: View Channels, Send Messages, Embed Links, Manage Roles, Manage Nicknames, Kick Members. Rola bota musi być ponad rangami i osobami, którymi zarządza. Włącz Message Content Intent, aby odczytywać logi webhooka.

## Lokalnie
Node >=22.12, npm ci, skopiuj .env.example do .env i uzupełnij, npm start. npm test oraz npm run check do kontroli. Nie publikuj .env ani tokenu. Baza musi być osobna dla tego bota.

Nagrody: po piątym plusie licznik wraca do zera, a ukończony cykl zostaje w historii. Co niedzielę o 20:00 Europe/Warsaw bot kolejkuje na logach nowe nagrody (wiele cykli jednej osoby sumuje). Brak nagród oznacza brak wiadomości. Po przerwie nadrabia zestawienie po uruchomieniu. Zestawienie nie potwierdza wypłaty; nagrody już wykazane nie są ponawiane w następnym tygodniu.

Codziennie o 20:00 Europe/Warsaw: przypomnienie o kursach na kanale 1502335151324004457 z oznaczeniem roli 1465037223350243390. Kontrola co sekundę; po restarcie po 20:00 nadrabia wiadomość tego dnia. Baza zapobiega ponownemu zaplanowaniu tego samego dnia. Dostarczenie zależy od dostępności Discord i bota.

Stały panel zarządu: kanał 1502336969605251102. Bot tworzy jedną wiadomość i aktualizuje ją po restarcie. Wybór osoby otwiera prywatny widok; przyciski Plus, Minus, Awans, Degradacja, Zwolnienie otwierają formularz powodu. Wyniki z panelu i tych komend trafiają na dedykowane kanały w src/config.js. Zatrudnianie i urlopy pozostają komendami z odpowiedzią na kanale użycia. Kanał panelu powinien być widoczny tylko dla zarządu i bota; bot wymaga tam View Channel, Send Messages, Embed Links, Read Message History. Ranga kadry jest weryfikowana przy każdym działaniu.

Generator plakietek na kanale 1292911416516415592: przycisk daje prywatnie /opis i /zmiennick dla pierwszego imienia oraz najwyższego stanowiska. Wymaga Firma Dc. Obsługuje 10 stanowisk, z SZEF dla najwyższej rangi. Nie zmienia rang ani pseudonimu na Discordzie. Bot wymaga dostępu do kanału, wysyłania wiadomości, embedów i historii.

/nagrody [strona] — prywatny podgląd dla zarządu wszystkich nierozliczonych nagród, z liczbą cykli na osobę. Tylko odczyt, bez logowania i bez pingów. Niedzielny raport ma przycisk Rozliczono dostępny dla kadry: oznacza wyłącznie nagrody tego raportu, zachowuje historię i nowe cykle zebrane później.

Import webhooków: nowe logi na kanale 1530621541325340682 powodują zmianę rang, nadanie lub zdjęcie urlopu i zwolnienie z usunięciem z serwera. Dopasowanie po pełnym imieniu i nazwisku w pseudonimie (pomija tagi w nawiasach) lub zapisanych danych IC. Brak lub wiele dopasowań: błąd na kanale logów, bez zgadywania. Komunikaty oznaczają pracownika na kanałach docelowych; urlopy na 1502336468016828567. Źródło wyłącznie do odczytu. Urlop bezterminowy trwa do zdjęcia. Baza deduplikuje zdarzenia; przerwane działania wymagają sprawdzenia historii. Dawniej przekazane logi nie są wykonywane ponownie. Nie odczytuje starej historii ani logów z czasu wyłączenia. Wymagany Message Content Intent i Server Members Intent.

Kursy i koło: na tym samym kanale źródłowym bot czyta wyłącznie webhooki w formacie `BURGERSHOT Zakończenie Kursu` oraz `Gracz … zakończył Kurs #… dla burgershot.`. Osobę dopasowuje po nazwie w nawiasie lub po nazwie Discorda na całym serwerze. Tylko wpisy z dokładnym `Kurs #4` zwiększają licznik kursów widoczny w panelu. Wpis `Kurs #1` oznacza pracownika jako aktywnego na 10 minut; status bota odświeża się co 10 minut i pokazuje `aktywni/Firma DC` (np. `10/65 aktywnych`). Każda osoba, w tym Zarząd, otrzymuje jedno losowanie `/kolo` za każde 20 takich wpisów i korzysta wyłącznie z własnych losowań. `/reset` jest dostępne wyłącznie dla Zarządu i zeruje wszystkim liczniki kursów oraz dostępne losowania; historia nagród zostaje zachowana. Naprawka, aparat, obiektyw i zdrapka mają po 22,5% szans; 10 000$ ma 10% szans. Nagrody wypłaca Zarząd w niedzielę. Źródłowy webhook pozostaje tylko do odczytu.

/komenda tryb:U ukrywa globalnie /awans, /degrad, /urlop, /zdejmijurlop i /zwolnij z listy slash. tryb:P je przywraca. Wymaga rangi zarządu. Ustawienie zapisane w bazie i odtwarzane przy restarcie. Tablet, import logów i działania kadrowe zachowują dotychczasowe zasady.

Hierarchia komend i tabletu: Rekrut → Nowicjusz → Pracownik → Starszy pracownik → Specjalista → Doświadczony Specjalista → Kierownik zmiany (1292911416285728792). Kierownik (1292911416306569307) jest wyżej i pozostaje poza automatycznym awansem o jeden stopień.

## Panel administracyjny WWW
Widoki: przegląd, profile pracowników, filtrowana historia, urlopy, nagrody i widoczność komend U/P. Działania korzystają z tej samej obsługi co Discord. Dostęp tylko przez OAuth2 Discord i aktualną rangę Zarząd 1295044894825381950. Dane API nie są publiczne.

Railway: wygeneruj domenę dla portu 3000 (lub wartości PORT). Ustaw DISCORD_CLIENT_SECRET z OAuth2 aplikacji bota. PUBLIC_URL może być pominięte, jeśli Railway ustawia RAILWAY_PUBLIC_DOMAIN. W Discord Developer Portal → OAuth2 → Redirects dodaj https://TWOJA-DOMENA/auth/callback. Nie publikuj sekretu w repo ani czacie. Klucz sesji jest generowany i trwale przechowywany w bazie; nie trzeba ustawiać SESSION_SECRET. /healthz zwraca gotowość bota.

Podgląd lokalny: node scripts/preview-web.mjs, http://127.0.0.1:3100/demo. Wyłącznie lokalne dane demonstracyjne, bez dostępu do serwera Discord; skrypt nie jest kopiowany do obrazu produkcyjnego.

