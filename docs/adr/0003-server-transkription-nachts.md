# Der Server transkribiert nachts als Fallback

Der Pi rechnet nachts zwischen 3:00 und spätestens 8:00 selbst: alles, was offen ist, alles, was
seit zehn Minuten keinen Fortschritt mehr meldet, und alles Fehlgeschlagene. Das ersetzt ADR 0001
dort, wo es um den Fallback geht – „kein Server-Fallback" gilt nicht mehr, „kein Cloud-Dienst"
weiterhin.

## Was dafür aufgegeben wurde

- **Speicherbudget.** ADR 0001 nannte 1 GB. Während eines Laufs liegen jetzt 1,5–2 GB im Speicher
  (Parakeet int8, 670 MB Modell + Aktivierungen). Das Modell wird erst um 3:00 geladen und nach
  dem Lauf wieder freigegeben – außerhalb des Laufs bleibt der Verbrauch beim alten Stand.
- **„Keine nativen Abhängigkeiten".** `onnxruntime-node` bringt fertige arm64/amd64-Binaries mit;
  es braucht keine Toolchain, ist aber ein nativer Bestandteil des Images (das Argument von damals
  war die Kompilier-Toolchain, nicht das Binary an sich).
- **Kein ffmpeg.** Weiterhin keins: Dekodiert wird per WASM (`opus-decoder`, `ogg-opus-decoder`,
  `ts-ebml`), und die Audiodateien bleiben unverändert (ADR 0002 gilt unverändert).

## Wie der Server rechnet

Dasselbe Modell wie die Clients (Parakeet TDT 0.6B v3 int8, dieselben drei Dateien von Hugging
Face) in einem **Worker-Thread**: der Thread fasst die Datenbank nicht an, liefert Segmente zurück,
und ein hängender Job lässt sich mit `worker.terminate()` beenden. Die Mel-Vorverarbeitung kommt
aus `parakeet.js/mel` – genau der Code, den auch der Browser benutzt –, der Greedy-TDT-Dekoder ist
nachgebaut. Damit ein Transkript nicht davon abhängt, wer gerechnet hat, sind die Satzgrenzen
(`splitSentences`, 24 Wörter bzw. Satzzeichen) auf beiden Seiten identisch.

## Übernahme statt Warteschlange

Ein Job hat eine **Revision** (`transcription_jobs.epoch`). Übernimmt der Server einen Job, erhöht
sich die Revision; jeder Schreibversuch mit alter Revision wird mit `409 JOB_REVOKED` abgewiesen.
Ohne das würde ein noch laufender Tab sein Ergebnis über das des Servers schreiben. Übernommen
werden nur Jobs, deren Heartbeat seit zehn Minuten ausgeblieben ist – ein gesunder Client darf
fertig rechnen.

## Grenzen

- Nur Opus (WebM aus Chrome/Android, Ogg aus Firefox). AAC/M4A (Safari) braucht FAAD2 und einen
  Demuxer für fragmentiertes MP4; das bleibt vorerst der Client-Transkription vorbehalten.
- Die Laufzeit auf dem Pi ist gemessen auf x86 (RTF≈0,05), auf ARM aber nur geschätzt (0,2–0,5).
  Bei einem Rückstau von mehreren Stunden Audio braucht es mehrere Nächte.
- Fehlgeschlagene Jobs werden unbegrenzt jede Nacht erneut versucht (bewusste Entscheidung): eine
  dauerhaft kaputte Aufnahme kostet damit jede Nacht bis zu zwei Stunden Budget. Der Admin-Block
  zeigt die Versuche, damit man die Aufnahme löschen kann.
